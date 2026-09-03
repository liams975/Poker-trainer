-- ============================================================
-- Phase 10: an attempt cannot name a session it does not own
-- ============================================================
--
-- `docs/05-ui-ux.md` has carried this as an open issue since Phase 7:
--
--   "An attempt may name a session it does not own. Harmless today — every
--    read of `drill_attempts` is scoped to the reader by RLS, so a forged
--    `session_id` cannot put rows into anyone else's history. Worth a
--    constraint if session aggregates ever get computed server-side."
--
-- Phase 9 crossed exactly that line. `awardSessionRewards` closes a session,
-- reads back the attempts carrying its id, and pays XP from what it finds.
-- The RLS scoping still holds — nobody can inject attempts into another
-- person's payout, because nobody can see another person's rows — but the
-- shape that note was watching for now exists, and Phase 10 reads the same
-- rows again for session history. So the constraint lands.
--
-- What it prevents is a row whose `user_id` and `session_id` disagree about
-- whose it is. Today that is only self-inflicted; `drill_attempts` is
-- append-only, so such a row could never be corrected afterwards, which is
-- the better argument for refusing it at write time than for tolerating it.

-- The referenced pair must be unique before anything can point at it. `id` is
-- already the primary key, so this costs an index that can never have a
-- duplicate and exists only to give the foreign key something to name.
alter table drill_sessions
  add constraint drill_sessions_id_user_key unique (id, user_id);

-- Replaced, not supplemented.
--
-- 0001 already declares `foreign key (session_id) references drill_sessions(id)
-- on delete set null`. The composite key below implies it — if the pair
-- references (id, user_id) then session_id references id — so keeping both
-- would mean two constraints enforcing overlapping facts and two referential
-- actions firing on the same delete.
alter table drill_attempts
  drop constraint drill_attempts_session_id_fkey;

-- `set null (session_id)`, and the column list is load-bearing.
--
-- A bare `on delete set null` on a composite key nulls *every* column in the
-- key — here that means `user_id` too, which is `not null`. Deleting a session
-- would then fail with a constraint violation instead of orphaning the
-- attempt, and account deletion cascades through `drill_sessions`, so this
-- would break deleting an account rather than anything obscure.
--
-- The column list form is Postgres 15+. The local stack and the deployed
-- project are both 17.6.
--
-- The action itself is unchanged from 0001 and the reasoning is the same: an
-- attempt outlives the session that produced it, because the attempt is the
-- fact and the session is only its container.
alter table drill_attempts
  add constraint drill_attempts_session_is_own
  foreign key (session_id, user_id)
  references drill_sessions (id, user_id)
  on delete set null (session_id);

-- Nulls are the subtle part, and they are correct by default. MATCH SIMPLE —
-- what you get without saying otherwise — skips the check entirely when any
-- column of the key is null. So an attempt whose session has been deleted
-- keeps its `user_id`, stops being checked, and stays exactly as valid as it
-- was before.
