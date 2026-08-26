# 05 — UI / UX

## Design thesis: a lab, not a casino

The templated answer for a poker app is green felt, gold trim, card imagery,
Vegas energy. Reject it. That visual language says *gambling*, and this
product's promise is the opposite: **poker as a craft you study.**

The real aesthetic vernacular of serious poker study is solver software —
dense matrices, frequency percentages, tabular numerals, color as data. The
app should feel like a precision instrument. Closer to a trading terminal or a
scientific tool than to an online casino.

## Tokens

### Color

One governing rule, and it is the whole system:

> **Saturated color is reserved exclusively for strategy data.**
> Chrome, nav, cards, and text are monochrome. The only thing glowing on the
> screen is information.

This is why the app will look unlike a generic dashboard: everywhere else
teams spend color on branding, here it is spent on meaning.

```
Base            #0B0F14   cool near-black
Surface         #141A21
Surface raised  #1C242D
Border          #2A3540
Text primary    #E6EDF3
Text secondary  #8B9AA8
```

Action colors are the **Okabe–Ito** palette, which is designed to be
distinguishable under all common forms of color vision deficiency. Given a
male-skewed poker audience where roughly 1 in 12 has some CVD, this is a
functional requirement, not a nicety.

```
Raise / Bet     #D55E00   vermilion
Call            #0072B2   blue
Check           #009E73   bluish green
All-in          #CC79A7   reddish purple
Fold            #55606B   desaturated gray — folding is the absence of action
```

```
Accent (chrome) #E8B04B   muted amber — streak and XP rail ONLY.
                          Never appears in a range grid.
```

Grade tiers reuse action hues rather than introducing a red/green pass-fail
axis: optimal reads as confident, blunder as alarming, without implying that
"not optimal" means failure — which for mixed strategies would be false.

### Type

- **Display:** Instrument Sans (or General Sans) — a tight grotesque with
  some character, used with restraint for headings and mode cards.
- **Body:** Inter, with `font-feature-settings: 'tnum'` enabled globally.
- **Data:** JetBrains Mono for all frequencies, percentages, EV figures, and
  the range grid.

**Tabular numerals are non-negotiable.** Frequency columns must align
vertically or the grid becomes unreadable. This is a functional typographic
constraint, not a stylistic one.

### Grid

The 13×13 matrix is the organizing geometry of the whole product. Derive the
spacing scale from it and echo the modular grid in dashboard card layout and
nav rhythm. The structure of the interface should rhyme with the structure of
the domain.

---

## Signature element: the frequency cell

Every cell in the 13×13 grid is **not a solid color**. It is a stacked bar
rendering the hand's actual mixed strategy — `AJo` at 60% open / 40% fold
draws as 60% vermilion, 40% gray, within the cell.

Most range-chart UIs fill each cell with the single dominant action. That
design teaches a lie: it tells the user `AJo` "is a raise" when it is a
frequency. The stacked cell makes mixed strategy visible **across the entire
grid at a glance**, which is the single most important concept the app
exists to teach.

It also gives you colorblind redundancy for free: proportion encodes the
information alongside hue, and every cell always shows its hand notation.

Spend the design boldness here. Everything else stays quiet.

---

## Homepage: a study desk, not a single path

You asked for choice on the homepage rather than one linear journey. The
model is a **study desk** — the user arrives and decides how they want to
work today, with progress visible but not dictating.

```
┌───────────────────────────────────────────────────────────────┐
│  TODAY   streak · daily goal ring · XP level · accuracy trend │
├──────────────────────────────────────────┬────────────────────┤
│                                          │                    │
│   ┌────────────┐  ┌────────────┐         │   PROGRESS         │
│   │ Continue   │  │ Quick      │         │   track position   │
│   │ Learning   │  │ Drill      │         │   module list      │
│   └────────────┘  └────────────┘         │                    │
│   ┌────────────┐  ┌────────────┐         │   WEAK SPOTS       │
│   │ Focused    │  │ Weak       │         │   3 tags, tap to   │
│   │ Drill      │  │ Spots      │         │   drill directly   │
│   └────────────┘  └────────────┘         │                    │
│   ┌────────────┐  ┌────────────┐         │   RECENT           │
│   │ Range      │  │ Session    │         │   last sessions    │
│   │ Explorer   │  │ Review     │         │                    │
│   └────────────┘  └────────────┘         │                    │
└──────────────────────────────────────────┴────────────────────┘
```

Six entry points:

| Mode | What it is |
|---|---|
| **Continue Learning** | Resume the track — next lesson and its drills |
| **Quick Drill** | 20 mixed spots from unlocked material. Low friction. |
| **Focused Drill** | Filter by position / scenario. Deliberate practice. |
| **Weak Spots** | Adaptive sampling from lowest-accuracy skill tags |
| **Range Explorer** | Free-form chart study and comparison. No grading. |
| **Session Review** | History, mistake log, accuracy over time |

The progression path lives in the right rail — present and motivating, but
not the only door. A returning intermediate player who wants to grind
blind-defense spots for 40 minutes can do that in one click without walking a
path designed for someone else.

Gamification sits in the TODAY strip and the rail: streak, daily goal ring,
XP level, achievements. **Moderate depth by design** — no leagues, no
hearts/lives, no leaderboards in v1. Hearts in particular punish
experimentation, which is exactly the wrong incentive in a skill trainer.

---

## The desktop advantage: things a phone app can't do

This is why laptop-first is not a compromise. Build these deliberately.

**1. Side-by-side, always.** In the drill screen, the spot stays on screen
while the range grid and rationale appear beside it. On mobile this must be a
modal that hides the spot. Here the user sees the decision *and* the chart
simultaneously — which is materially better for learning.

```
┌─────────────────────────┬─────────────────────────┐
│   Table + hole cards    │   [after answering]     │
│   Action history        │   Grade + frequencies   │
│                         │   13×13 grid, your hand │
│   [F] [C] [R 2.5x] ...  │   highlighted           │
│                         │   Structured rationale  │
└─────────────────────────┴─────────────────────────┘
```

**2. Keyboard-first operation.** `F` fold, `C` call, `R` raise, number keys
for sizings, `Space` to advance, `?` for shortcuts, `⌘K` command palette to
jump to any mode. A user should be able to run a 50-spot session without
touching the mouse. This is what makes the app feel like a serious tool and
lets drill velocity go up several-fold.

**3. Compare mode in Range Explorer.** Two charts side by side with diff
highlighting — "how does my BTN opening range change vs. a 3-bettor?"
Genuinely difficult on a phone, and it's the feature serious students will
tell other people about.

**4. Study Mode vs Drill Mode.** A toggle that changes the pedagogy:

| | Study Mode | Drill Mode |
|---|---|---|
| Chart | Visible *before* answering | Hidden until answered |
| Timing | Untimed | Optional timer |
| Rationale | Verbose, all factors | Concise, key factor |
| Scoring | Not recorded | Recorded to stats |
| Purpose | Understand the spot | Test recall under pressure |

Study Mode is the "intentional study session" feature. It is the reason
someone opens this on a laptop with 45 minutes rather than on a phone in a
queue, and no mobile-first competitor will build it well.

---

## Feedback moment

This is where retention is won or lost. After an answer:

1. Grade tier lands immediately — under 100ms, no spinner.
2. The full frequency distribution appears. **Always show the mix**, never a
   bare right/wrong.
3. The user's hand highlights in the grid, in context with its neighbors.
4. Structured rationale renders as factor chips (position, blockers, pot
   odds), expandable in Study Mode.

Animation should be quick and confident. Framer Motion, short durations,
respect `prefers-reduced-motion`. No celebratory confetti on a correct fold —
the tone is a coach nodding, not a slot machine paying out.

## Copy

Plain, active, specific. The interface speaks like a good coach: direct,
never condescending, never hyped.

- "Also fine — this is a mixed spot" beats "Not quite!"
- "You folded. This hand opens 60% of the time here." beats "Incorrect."
- Empty states invite action: "No weak spots yet — drill 20 hands and check back."
- Errors say what happened and what to do. They don't apologize.

Never tell a user they were wrong when they chose a positive-frequency
action. That is both pedagogically false and the fastest way to lose a
knowledgeable player's trust.

## Quality floor

Visible keyboard focus on every interactive element. Full keyboard navigation
including the grid. `prefers-reduced-motion` respected. Contrast checked
against WCAG AA. Verify the grid against a CVD simulator before Phase 6
closes — it is an exit criterion, not a polish item.
---

## What Phase 5 decided

The shell exists. Tokens, auth, providers and the study-desk dashboard in its
empty state. Phases 6–9 drop into this frame rather than redesigning it.

### Dark only, and no theme toggle

This document specifies exactly one palette, so there is no light variant to
design and nothing to toggle between. `color-scheme: dark` is set once and
`globals.css` carries no `prefers-color-scheme` block. If a light theme is ever
wanted it is a real design exercise, not a CSS inversion — the whole system
rests on saturated data reading against a near-black ground.

### Tailwind v4, so the tokens live in CSS

v4 is CSS-first: there is no `tailwind.config.js`. The `@theme` block in
`apps/web/src/app/globals.css` *is* the theme, and shadcn/ui's own variable
names are aliased onto our tokens there so a component copied in from the
registry inherits this palette instead of shipping neutral zinc.

### The quality floor is enforced, not asserted

Focus rings are applied globally via `:focus-visible` rather than per
component, so a control cannot ship without one. Reduced motion is a single
global media block rather than a hook threaded through components, so it cannot
be forgotten. Both are covered by `apps/web/e2e/shell.spec.ts` — including the
complement case that animation is *not* flattened by default, because a
stylesheet that killed all motion unconditionally would otherwise look
identical to one that respects the preference.

`eslint-plugin-jsx-a11y` covers the structural half on every lint run.

### Auth is three layers, and only the third is trusted

```
proxy.ts    session refresh + optimistic redirect. UX. Assumed bypassable.
requireUser()   getUser() against the auth server. Every protected route.
RLS         Phase 4. Holds even if both layers above are defeated.
```

Next 16 renamed `middleware.ts` to `proxy.ts`, and its own auth guide is
explicit that the proxy layer "should not be your only line of defense".

The `e2e` suite tests the middle layer *in isolation* by deleting an account
server-side while its cookie is still live: the token stays well-formed and
unexpired, so anything that merely inspects the token lets it through, while
`getUser()` is told the user is gone. Without that case, every auth test passes
with `requireUser()` deleted entirely — confirmed by deliberately breaking it.

### Still open

- **Google OAuth and the email-confirm route are unverified.** Both are written
  and reviewed but cannot be exercised locally: there are no Google credentials
  on a dev machine, and `enable_confirmations` is off locally so the RLS suite
  can sign users up. Phase 10 should exercise both against a deployed URL.
- **No command palette yet.** `⌘K` is specified in this document as a desktop
  advantage; it needs destinations to jump to, so it belongs with Phase 7.
- **`framer-motion` is not installed.** Nothing animates yet beyond a skeleton
  pulse, and `prefers-reduced-motion` is handled in CSS. The feedback moment in
  Phase 7 is what justifies the dependency.

---

## What Phase 6 decided

The Range Explorer is live: the first vertical slice, and the first place the
frequency cell exists.

### The cell encodes the mix three ways, and the label is the fourth

Hue (Okabe–Ito), **proportion**, and a **fixed left-to-right segment order**
(passive → aggressive, identical in every cell and every chart), plus an
`aria-label` spelling the mix out in words. So the grid is readable in
greyscale, under any CVD, and by a screen reader.

This is the interpretation of CLAUDE.md's "every action also carries a glyph or
label": a per-segment glyph is not legible at a 44px cell, so the naming lives
in the legend, the hand-detail panel, and the accessible name. The **order** is
what carries the redundancy inside the cell itself.

### Compare mode fades what is the same, rather than painting what changed

The first version washed every changed cell in the accent amber. That looked
fine and broke a locked rule — this document reserves amber for the streak and
XP rail and says it must *never appear in a range grid*. With 73 of 169 hands
differing between BTN and UTG opens, the result was a sixth colour covering
half the matrix, competing with the five that mean something.

Now the unchanged cells drop to 30% opacity and the changed ones stay at full
strength. No new hue enters the grid at all, and the eye still goes straight to
the difference.

`e2e/range-explorer.spec.ts` enforces this: it scans every node inside every
grid for the accent colour, in single and compare mode. The **keyboard focus
ring is the one deliberate exception** — it is transient, app-wide, and follows
the caret rather than encoding anything about a hand — so the check parks focus
outside the grid first.

### Colourblind safety is a test, not a one-off check

`apps/web/tests/action-colors.test.ts` applies protanopia, deuteranopia and
tritanopia transforms to the palette and asserts a minimum pairwise distance
under each. Verified by mutation: moving `call` to a nearby green fails under
both protanopia and deuteranopia.

A simulator check verifies today's palette; this verifies every future one.

### Still open

- **The grid caps at 13 columns of ~44px.** Comfortable on a laptop, and
  compare mode needs a wide window to sit two matrices side by side. Below
  `2xl` they stack vertically, which works but loses the at-a-glance diff.
- **No URL state.** Reloading returns to `BTN open`; a chart cannot be linked
  to or shared. Worth adding when there is something to share it *with*.
