# 06 — Claude Code Workflow

How to run this build without losing direction or accumulating files nobody
understands.

## The core problem

Agentic coding fails in two characteristic ways. **Drift**: the agent
gradually reinterprets the goal until you're three phases from what you
wanted. **Sprawl**: it creates helper files, utils, and abstractions faster
than you can review them, and within a week nobody knows what's load-bearing.

Both have the same root cause — the agent making structural decisions without
a gate. The whole setup below exists to insert gates.

## Anti-drift: phase gates and plan mode

The single highest-leverage practice, worth more than any agent
configuration:

> **Never let Claude Code write code before you approve a file list.**

For each phase: it reads the spec, enters plan mode, produces a plan naming
the files it will create and modify, and stops. You read the list. If it
proposes 23 files for a phase that should take 7, you catch it *before* the
code exists rather than during review.

This is also the natural checkpoint for your own review habit — you see the
shape of the work before it's executed, and correcting a plan costs a
sentence where correcting an implementation costs an afternoon.

Rules that make this stick:

- One phase per session where practical. Fresh context per phase keeps the
  agent focused on the current spec instead of half-remembering earlier ones.
- If the plan turns out to be wrong mid-phase, **stop and re-plan** rather
  than expanding scope inline. Scope expansion mid-implementation is exactly
  how sprawl happens.
- End every phase at its exit criteria with tests green. Never roll straight
  into the next phase because it "seemed natural."

## Anti-sprawl: structural rules

Put these in CLAUDE.md so they're enforced every session, and make the
reviewer agent check them.

- **No new top-level directories** without asking.
- **No new dependencies** without stating why in the commit.
- **No `utils.ts` / `helpers.ts` / `misc.ts`.** Junk-drawer filenames are
  where unreviewed code goes to hide. Name modules for what they do.
- **The engine import restriction is a lint rule**, not a convention. It fails
  CI. Conventions erode; lint rules don't.
- Prefer editing an existing file over creating a new one.

## Agents: two, not twelve

Solo projects rarely benefit from elaborate agent hierarchies. Two subagents
earn their place here:

### `reviewer`
Runs at every phase exit. Fresh context, so it reads the code as written
rather than as remembered. Checks:

- RLS enabled and policied on every new table
- No secrets or service-role keys in client code
- Engine purity — no React/DOM/`process.env` imports
- No `Math.random()` outside `engine/rng`
- Client never writes `entitlements`
- New files justified by the approved plan

### `engine-tester`
Writes tests for `packages/engine`. Separated because test-writing wants an
adversarial mindset — "how do I break this?" — that conflicts with the
implementation mindset. Especially valuable for the evaluator property tests
and the grading tier boundaries.

Resist adding more until you feel a specific pain. An agent org chart built
in advance is speculative complexity.

## Skills: three

Skills are versioned, discoverable, and loaded on demand — which is precisely
what scattered one-off scripts are not.

### `poker-domain`
The most valuable of the three. Contains: 6-max position order and
terminology, the 169-hand notation system, the range data format, chart
addressing, grading tiers, and the mixed-strategy principle.

**Why it matters:** without it, Claude Code will hallucinate poker specifics
— inventing position names, treating ranges as binary include/exclude sets,
writing "correct answer" grading. With it, the domain model stays consistent
across sessions and months.

### `supabase-migration`
Enforces the migration conventions: never edit an applied migration, RLS in
the creating migration, policy naming, and the RLS test cases from
`docs/04-data-model.md`.

### `ui-conventions`
The design tokens, the saturated-color-is-data rule, the keyboard shortcut
map, and the accessibility floor. Prevents slow visual drift toward generic
dashboard defaults over dozens of components.

## CLAUDE.md hygiene

CLAUDE.md is loaded into every session, so its length is a running tax and a
bloated one dilutes the rules that matter.

- Keep it a **reference card**. Detail goes to `/docs` with a link.
- Prune it. If a rule stopped being violated, it can go.
- If you find yourself correcting the same mistake twice in chat, that's the
  signal to add a line — not before.

## Practical session loop

```
1. New session. State the phase.
2. "Read docs/02-roadmap.md Phase N and docs/0X-<relevant>.md."
3. "Plan this phase. Do not write code yet."
4. Review the file list. Push back on anything unjustified.
5. Approve. It implements.
6. pnpm typecheck && pnpm test && pnpm lint
7. Run the reviewer agent.
8. Commit. Stop. Next phase in a fresh session.
```

## When it goes wrong

- **Producing files you didn't approve** → stop it, revert, re-plan. Don't
  let it "finish first." Half-approved work is how a codebase becomes
  unreviewable.
- **Losing the thread mid-phase** → the phase is too big. Split it.
- **Contradicting a locked decision** → that decision isn't in CLAUDE.md
  clearly enough. Fix the file, not just the conversation.
- **Tests passing but behavior wrong** → the test asserts implementation
  rather than behavior. Common in the engine; the naive-vs-fast evaluator
  oracle pattern exists specifically to avoid this.