# Puzzle League — design and implementation brief

A private over-the-board puzzle tracker for one chess student. Not a product, not multi-tenant, no onboarding flow. One student, two coaches.

This document is the design spec. Where a number is unresolved it says so — do not invent a value to fill the gap. Ask or leave it configurable.

**Revision 4 — 2026-11-08.** Decisions from the review are folded into the sections below and listed in §9 *Decision log*. Status: **built** — see `docs/ARCHITECTURE.md` for how and `docs/SETUP.md` to deploy.

---

## 1. What the system does

The student solves tactics puzzles from a physical book, on a real board, away from a screen. He then enters his full line in the app. The app checks it against the book's answer key, and a coach confirms or corrects the grade. That grade feeds two separate numbers.

**Puzzle rating** — Elo, moves up and down. The honest skill signal. Coach-facing only.
**Season XP** — accumulates through play. Drives rewards. Student-facing.

Wrong answers cost rating. They never cost XP. That separation is the core of the design; don't collapse it into a single score. (The only thing that can reduce XP is a coach correcting a grade — see *Grade corrections*.)

### Source book

Carsten Hansen, *Daily Chess Training: Chess Tactics — Volume 1* (CarstenChess, 2019). 404 puzzles, grouped into numbered Sets, referenced as `<set>.<n>` (e.g. `4.7`). Each puzzle carries a printed difficulty marker and a hint. The book deliberately does not state the objective — mate, fork, pin, positional gain, depth of calculation.

The owner has the book as an ebook. The answer key (main line for each puzzle), difficulty marker and hint will be extracted from it into the answer-key data. That extraction is a data task, not part of the app.

> **UNRESOLVED:** the difficulty scale is assumed to be 1–5 stars. Confirm against the book's key page (available in the ebook) before hardcoding. If it is a word label rather than stars, the tier table below maps 1:1 onto whatever the labels are.

### Rating maths

```
E = 1 / (1 + 10^((puzzle_rating - student_rating) / 400))
S = 1.0 full | 0.5 partial | 0.0 wrong
new_rating = student_rating + K * (S - E)

K = 40 for the first 30 graded puzzles, then 24
```

Only first attempts count toward the 30 (re-attempts are not graded for rating — see *Re-attempts*).

Puzzle rating comes from the printed difficulty, via a lookup table that is editable in the admin view:

| Difficulty | Rating fed to the formula |
|---|---|
| 1 star | 1400 |
| 2 star | 1600 |
| 3 star | 1800 |
| 4 star | 2050 |
| 5 star | 2300 |

> **UNRESOLVED:** these are provisional and must be calibrated from a ten-puzzle session spread across the range before launch. Store them as editable config, not constants.

**Config edits apply going forward only.** Each attempt stores the puzzle rating (and every other config value it was scored with) at the moment it was graded. Changing the table later never changes past results.

Student starting rating: **1700**. Anchored to his 1900 chess.com rapid, discounted for the harder task. His 2800 chess.com Puzzles rating is not usable here — different pool, different task — do not reference it anywhere in the system.

### Submitting an attempt

The student does the solving on the physical board. The app is only where he records it:

1. Opens the puzzle (`Set 4 · 4.7`) and presses **Start** — this starts the timer.
2. Solves on the board and writes the line.
3. Enters in the app:
   - his **line** in algebraic notation, e.g. `Nxf7+ Kxf7 Qh5+ Kg8`;
   - **what he is playing for** (free text: "mate", "win the queen", "fork on e6"…);
   - a **"I used the hint"** checkbox;
   - a **"I think this is wrong"** checkbox (for the *Called it himself* bonus).
4. Presses **Finish**. The attempt is submitted and the timer stops.
5. He is then shown the book's answer, so he learns from it straight away.

### Grading

Grading is split between the app and the coach.

**Automatic check (instant, on Finish).** The line is compared with the answer key after normalising notation (ignore `+`, `#`, `x`, `!`, `?`, move numbers and spacing):

| Check | Provisional grade | Status |
|---|---|---|
| First move does not match the key | Wrong (0.0) | Final unless a coach changes it |
| Whole main line matches the key | Full (1.0) | Awaiting coach confirmation |
| First move matches, line diverges later | Partial (0.5) | Awaiting coach confirmation |

The check compares move text only — it has no board positions, so it cannot recognise a valid alternative move the book does not list. That is what the coach review is for.

**Coach review.** Every attempt appears in a verification queue. The coach confirms or changes the grade with one tap. The coach is the only one who can judge:

- whether the stated objective was right (needed for Full);
- right idea, wrong move order;
- right move for the wrong stated reason;
- a valid alternative line not in the book.

**Grading rules** the coach applies:

- **Full (1.0)** — correct first move, correct main line through the opponent's best defence, and he stated what he was playing for before showing it.
- **Partial (0.5)** — correct first move, line breaks down after; or right idea, wrong move order; or right move for the wrong stated reason.
- **Wrong (0.0)** — wrong first move. No partial credit for a wrong first move. (A genuinely correct first move that simply isn't in the book is not "wrong" — the coach marks it on its merits.)
- **Hint taken** — caps the result at 0.5 regardless of how good the line is. The student ticks the checkbox himself; record `hint_used` as a boolean on the attempt.

### Grade corrections

A coach can change any grade **at any time**, including long after it was recorded. When that happens:

- **Rating** is recalculated as if the corrected grade had always been there. Rating history is therefore *replayed* from the stored attempts in order, never kept as a running total of deltas.
- **XP** is recalculated as well, so it can go down. Daily-cap and bonus effects are recalculated with it.
- **Physical rewards already handed over** (collectibles, Lego bags) are kept. Nothing physical is ever taken back.

### Re-attempts

The student can re-attempt any puzzle, including one he got wrong. A re-attempt:

- earns **no points of any kind** — no base XP and no bonus XP (Clean sheet, Hat-trick, Beat the clock, Called it himself);
- does **not** change the rating;
- does **not** count toward the monthly puzzle counts or the five-attempt session minimum.

It is still recorded in his history, and he still sees the book's answer afterwards.

### XP

Base XP depends on puzzle difficulty relative to the student's current rating:

| Puzzle rating vs student rating | Base XP |
|---|---|
| more than 150 below | 5 |
| within ±150 | 10 |
| more than 150 above | 18 |

Multiply by result: full ×1.0, partial ×0.5, wrong ×0.2. The wrong-answer XP is intentional — it pays for attempting and writing the line.

Bonuses:

| Bonus | Condition | XP |
|---|---|---|
| Clean sheet | a session with zero wrong (see *Session* below) | +15 |
| Hat-trick | three full results in a row, repeatable within a session | +10 |
| Beat the clock | a Full result inside the puzzle's set time (only if that puzzle has one) | +3 |
| Called it himself | he ticks "I think this is wrong" before submitting, and the final grade is Wrong | +5 |

**Session.** A session is all of the student's first attempts in one UK calendar day. A session needs at least **5** first attempts to qualify for Clean sheet (editable config). This stops a single easy puzzle from earning +15 every day.

**Beat the clock.**

- The time limit is set **per puzzle by a coach** and is **optional**. Puzzles without one simply can't earn this bonus.
- The student starts and stops the timer himself (Start / Finish, above).
- The server records its own timestamps at Start and at Finish and computes the elapsed time from those. A time sent by the browser is never trusted. The bonus is awarded on the server.

**Daily XP cap: 120**, *including* bonuses. Prevents a weekend binge from buying a month of progress.

**Time zone.** All "day" and "month" boundaries use UK time (`Europe/London`, so BST is handled): the day resets at midnight UK time year-round.

### Divisions

Student-facing ladder. The rating number itself is never shown to the student.

| Division | Band |
|---|---|
| Division 5 | below 1600 |
| Division 4 | 1600–1699 |
| Division 3 | 1700–1799 (start) |
| Division 2 | 1800–1899 |
| Division 1 | 1900–1999 |
| Premier | 2000–2149 |
| Hall of fame | 2150+ |

**At launch** Division 5, 4 and 3 count as held (he starts in Division 3). Division 2, Division 1, Premier and Hall of fame are locked until he reaches them.

Promotion is immediate on crossing a band. **Relegation only after two consecutive calendar months ending below the band, and it drops exactly one division** — never more, however far the rating has fallen. One bad month is noise. Month-end ratings (UK time) are derived by replaying the attempt log, so no snapshot job is needed.

### Rewards

Two tracks, two reward types. Nothing physical on either track is ever taken back.

- **Skill track** — each promotion earns one physical collectible, displayed on a shelf. Re-promotion into a division already held earns nothing. Relegation does not remove an earned award.
- **Effort track** — each XP milestone releases the next numbered bag of a single Lego set, bought once up front. The set is built incrementally and lives on the student's desk. The instruction manual is given on day one.

**Lego set notes.** A Lego set comes in numbered bags (bag 1, bag 2, …); each bag builds one stage of the model. Sets vary from a handful to 30+ bags, so:

- The **total number of bags** is a config value a coach enters after buying the set.
- Bags should land **roughly once a week**, so progress is felt in weeks, not months. Choose a set whose bag count matches the length of time you want it to last (e.g. 12 bags ≈ 12 weeks).
- The on-screen nine-brick strip pages through the set in groups of nine (bags 1–9, then 10–18, …) with a label such as "Bag 11 of 18".

> **UNRESOLVED:** the XP-per-bag milestone. Set it after two weeks of real session data so bags land at roughly **one per week**. Store as config with a single editable number.

### Monthly season

Calendar month (UK time). Three tiers, so an outright miss is rare:

| Tier | Condition |
|---|---|
| Survival | minimum puzzle count attempted |
| Par | puzzle count + rating not below the month's starting value |
| Silverware | puzzle count + rating up 40 + at least 60% full results |

Puzzle counts are first attempts only.

> **UNRESOLVED:** the three puzzle-count thresholds. Derive from his actual first fortnight, not from a guess.

---

## 2. Access model

Three accounts. No signup, no invites, no roles table beyond these.

**Coach (×2)** — add puzzles and answers, grade and re-grade submissions at any time, award bonuses, edit the difficulty lookup and all config (including per-puzzle clock times and Lego bag count), set monthly targets, see the rating and every Elo delta.

**Student (×1)** — start and submit an attempt, see the book's answer after submitting, see division, XP, bags, badges, season progress, and his own history. Cannot edit anything already submitted.

The rating must not be present in the student's rendered DOM or in any API response the student account can reach. Hiding it with CSS is not sufficient.

The same applies to the **answer key**: no answer for a puzzle may reach the student's browser before he has submitted his first attempt on it.

### What the student sees instead of numbers

- **Division progress** — a word, never a number or a precise bar. Four steps: *Just started → Halfway there → Getting close → Almost there*. The server sends only the word.
- **Lego progress** — XP is not secret, so this can be exact: "40 XP to the next bag", bags earned, bags remaining.
- **Season tiers** — puzzle counts can be exact. The rating-based conditions (Par, Silverware) show only as met / not met.

---

## 3. Technical setup

- **Hosting:** Vercel.
- **Data:** a Google Sheet with five tabs: `puzzles` (including the answer key), `attempts`, `config` (dated change history), `awards` (manual XP) and `handovers` (physical rewards given). Rating, XP, divisions, bags and season progress are never stored; they are recomputed from these on every request.
- **Sheet access is server-side only.** The app's server functions read and write the sheet through a Google Cloud service account. The server strips the rating and any unrevealed answers before responding to the student account.
- **Never share the Google Sheet with the student's Google account.** He could open it and see the rating and every answer.
- **Logins:** three fixed accounts with passwords stored as Vercel environment variables; a signed session cookie identifies the role.
- **Setup steps:** see `docs/SETUP.md`.
- **n8n (optional):** a webhook pings the coaches when an attempt is submitted (`n8n/attempt-notify.workflow.json`). No scheduled jobs are needed.

---

## 4. Visual direction

A league scoreboard, not a SaaS dashboard. Dense rows, hard edges, tabular numerals, one loud accent. Dark-first, with a light theme that keeps the same structure.

Two accent colours mapped to the two tracks so colour carries meaning: green for skill, yellow for effort. Nothing else is coloured except error and warning states.

Do not use: cream-and-serif palettes, purple-to-blue gradients, Inter, rounded cards with accent rails, emoji as section markers.

### Tokens

```css
/* Dark is the base; light overrides below. */
:root {
  --bg:         #0D1014;
  --surface:    #161B21;
  --surface-2:  #1E242C;
  --line:       #2A323C;
  --line-soft:  #202730;
  --fg:         #EDEFF2;
  --fg-dim:     #98A2AE;
  --fg-faint:   #5C6672;

  --skill:      #4BC08E;
  --skill-dim:  #1F4E3C;
  --effort:     #F5C518;
  --effort-dim: #4A3C06;
  --on-effort:  #1A1405;
  --miss:       #E2614B;

  --r-sm: 3px;
  --r-md: 6px;
  --r-lg: 10px;
  color-scheme: dark;
}

@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --bg:         #E9ECEA;
    --surface:    #FFFFFF;
    --surface-2:  #F3F6F3;
    --line:       #D2D9D4;
    --line-soft:  #E2E7E3;
    --fg:         #11161A;
    --fg-dim:     #5A646E;
    --fg-faint:   #8C959E;
    --skill:      #157954;
    --skill-dim:  #CFE8DD;
    --effort:     #F5C518;
    --effort-dim: #FBEFC2;
    --on-effort:  #1A1405;
    --miss:       #BC3D28;
    color-scheme: light;
  }
}

:root[data-theme="light"] {
  /* repeat the light values verbatim so an explicit toggle wins both ways */
}
```

Every colour is defined on bare `:root` first. No component rule may use a literal colour.

Radii stay small throughout. A scoreboard does not have soft corners. Badges are the only circles.

### Type

```
Display / numbers:  "Barlow Condensed", 600–700, uppercase, letter-spacing .04em
Body:               "Public Sans", 400–600
Data:               "IBM Plex Mono", 500, font-variant-numeric: tabular-nums
```

Load from Google Fonts with a real fallback stack on each. Scale: 11 / 13 / 15 / 20 / 32 / 56. The 56 is used exactly once per view — the rating in coach view, the XP total in student view.

Anything that changes while the user watches it is set in Plex Mono with tabular numerals, so digits never reflow mid-count. This includes the attempt timer.

---

## 5. Screen structure

Single column, max-width 960, 32px between sections. One page serves both roles; a view switch in the header controls what renders.

| Block | Student | Coach also gets |
|---|---|---|
| Header | name, season chip, division badge | view switch, rating |
| Attempt | pick puzzle, Start/Finish timer, line + objective entry, hint and "I think this is wrong" checkboxes, book answer after submit | — |
| Hero | XP total, puzzles this month | Elo delta per attempt, expected score |
| Division ladder | seven rows, marker on current, word-step progress | exact band edges, points to next |
| XP → next bag | bar, XP to next bag, bags earned, bags remaining | milestone size, pace projection |
| Shelf | badges earned and locked, brick build | — |
| Season targets | three tiers with progress | verification queue (confirm / change grade, one tap) |
| Admin | — | puzzles and answer key, per-puzzle clock times, difficulty table, all config, Lego bag count |

### Components

**Division ladder.** Seven rows at 44px, separated by 1px `--line-soft`. Not a card. Held divisions carry a 2px `--skill` left edge with `--fg` text. The current row sits on `--surface-2` with a solid `--skill` left edge; its band renders in Plex Mono at `--fg-dim`. Locked rows are `--fg-faint` with no edge. Bands right-aligned and tabular. (In student view the band edges are not shown; the current row shows the word-step progress instead.)

**Progress bars.** 6px tall, `--r-sm`. Track `--line`, fill in that track's accent. Milestone markers are 1px vertical ticks in `--fg-faint` drawn over the track, not inside the fill. In student view the division bar snaps to the four word steps, not a continuous width.

**Badges.** 40px circles, 1px border. Earned: `--skill-dim` fill, `--skill` border, division numeral in Barlow Condensed. Locked: transparent fill, dashed `--line` border, numeral at `--fg-faint`.

**Brick build.** Nine slots in a staggered stack, paging through the set nine bags at a time. Each brick 100×26px at `--r-sm`, with a 6px stud strip above it:

```css
repeating-linear-gradient(90deg, currentColor 0 12px, transparent 12px 24px)
```

inset 10px on each side. Earned bricks fill `--effort`; empty slots are a 1px dashed `--line` outline at identical dimensions. Do not draw a minifigure or any branded toy form.

**Puzzle card.** Set and puzzle number in Plex Mono (`Set 4 · 4.7`), difficulty as filled and empty star glyphs, result as a stamp rather than a pill — rotated `-3deg`, 2px border in `--skill` or `--miss`, label uppercase Barlow Condensed. A provisional (unconfirmed) grade is marked as such until a coach confirms it.

---

## 6. Animation

One orchestrated sequence, triggered by a **Play session** button. Nothing animates ambiently. The page renders complete at rest in the finished state; Play snaps to the prior state in 0ms, then runs:

| Start | Beat | Motion |
|---|---|---|
| 0ms | puzzle card enters | `translateY(12px)→0`, opacity 0→1, 320ms, `cubic-bezier(.2,.8,.2,1)` |
| 320 | stars reveal | opacity + `scale(.8)→1`, 140ms each, 60ms stagger |
| 620 | result stamp | `scale(1.25)→1`, opacity 0→1, 240ms, `cubic-bezier(.34,1.3,.64,1)` |
| 900 | rating ticks (coach view only) | counter over 700ms, ease-out, driven by `requestAnimationFrame` |
| 900 | division bar fills | width transition 800ms, `cubic-bezier(.4,0,.2,1)` |
| 1700 | threshold crossed | bar flashes to white and back, 200ms |
| 1800 | ladder marker climbs | current row shifts up one, 420ms, `cubic-bezier(.34,1.4,.64,1)`; the vacated row fades to its held state over 300ms |
| 2100 | badge lands on shelf | `scale(.6)→1` + opacity, 360ms, same back-out curve |
| 2400 | XP counter | 600ms, ease-out |
| 2400 | XP bar fills | 700ms, same curve as the division bar |
| 3000 | bag unlocked chip | `translateX(-8px)→0` + opacity, 280ms |
| 3200 | brick drops | `translateY(-40px)→0`, 420ms, `cubic-bezier(.34,1.56,.64,1)` |
| 3620 | brick settles | `scaleY(1.06 → .94 → 1)`, 120ms |

Total 3.74s.

### Micro-interactions

These and nothing else:

- ladder rows lift to `--surface-2` on hover, 120ms
- buttons translate down 1px on `:active`
- counters always use tabular numerals so layout never shifts mid-count

### Reduced motion

Under `prefers-reduced-motion: reduce`, every transition drops to 1ms, counters set their final value directly, and the brick appears in place. The state change still happens; it simply does not move.

---

## 7. Out of scope

Do not build these, even if they seem like obvious additions:

- **A virtual Lego build beyond the nine-brick progress strip.** The real model is on a shelf. Any richer on-screen version makes the physical one feel like the lesser copy.
- **XP for building.** Building is the reward, not another scored activity.
- **Any reward tied to the rating or division that can be revoked.** Relegation already costs enough.
- **A student-visible rating number**, in any form, including a derived percentage or a "progress to next division" figure precise enough to reverse-engineer it. Word steps are fine; a number is not.
- **Confetti, particle bursts, or sound on promotion.** The brick landing is the celebration.
- **Multi-student support, leaderboards, or comparison with other players.** One student. Adding a second later is a rewrite, and that is the correct trade.
- **Streak counters that reset to zero.** A visible streak the student breaks on a sick day does more damage than the streak ever earned.
- **Board positions or a chess engine.** Answer checking is text comparison against the book; the coach covers what that misses.

---

## 8. Build order

1. Data model (Sheet tabs) and the grading/rating engine, with the config table editable. Test the Elo — including replay after a grade correction — against hand-worked cases before any UI.
2. Answer-key import from the ebook (main line, difficulty, hint per puzzle).
3. Coach view: verification queue, confirm/change grade, see the delta. This is the surface that has to be fast — if grading takes more than a minute a session, the system dies of admin fatigue.
4. Student attempt flow (timer, line entry, checkboxes, auto-check, answer reveal), then the student view, static, no animation.
5. The animation sequence last. It is the motivation layer, not the system.

---

## 9. Decision log

Decisions taken in review (2026-11-08). The sections above already reflect them.

| # | Topic | Decision |
|---|---|---|
| 1 | Grade corrections | Coach can change any grade at any time. Rating is replayed; XP is recalculated (can drop); physical rewards already given are kept. |
| 2 | Config edits | Apply to future grades only. Each attempt stores the values it was scored with. |
| 3 | Student progress display | Division progress as four word steps (*Just started → Almost there*). Lego progress exact in XP. Rating-based season conditions as met / not met. |
| 4 | Session | All first attempts in one UK calendar day; at least 5 to qualify for Clean sheet (editable). |
| 5 | Beat the clock | Optional time per puzzle, set by a coach. Student starts/finishes the timer; server timestamps decide the bonus. |
| 6 | Daily cap and time zone | Cap of 120 includes bonuses. UK time (`Europe/London`). |
| 7 | Relegation | One division at a time. |
| 8 | Held at launch | Division 5, 4 and 3. |
| 9 | Lego cadence | Roughly one bag per week (confirmed). Bag count entered as config; strip pages nine bags at a time. |
| 10 | Answer checking | Student enters his line; app auto-checks against the book's answer key; coach confirms or changes in a one-tap queue. Book answer shown to the student after submitting. Answer key extracted from the owner's ebook. |
| 11 | Re-attempts | Allowed. No points of any kind (base or bonus XP), no rating change, not counted toward monthly puzzle counts or the session minimum (confirmed). |
| 12 | Stack | Vercel + Google Sheets, server-side access via a service account, three password logins. |

### Implementation decisions (build, 2026-11-08)

Mechanical details the spec left open, decided during the build:

| Topic | Decision |
|---|---|
| Provisional grades | Count immediately (the student sees XP right after Finish); a coach confirmation or change re-runs the replay. |
| XP rounding | Whole XP per attempt, rounded half up (5 × 0.5 = 2.5 → 3). |
| Hat-trick | Every third consecutive Full in a day pays +10, then the run restarts. A Partial or Wrong resets it. |
| Beat the clock | Needs a Full result inside the set time. |
| Clean sheet timing | Awarded when the UK day closes (midnight), so a later wrong answer that day never takes back XP already shown. Added last in the day, so it can be clipped by the cap. |
| Manual coach XP | Coaches can award XP with a reason. It counts toward the daily cap and can be removed. |
| Answer alternatives | The answer key may list several main lines separated by `\|`. |
| Unset bag milestone | XP keeps accumulating; bags start releasing once the milestone is set. |
| Login | Password only; which of the three passwords matches decides the account. |
| Student wording | Season conditions are shown as "Held your level this month" / "A real step up in level" — the word "rating" never appears on his screen. |
| Light theme | Yellow *text* uses a darker gold token (`--effort-ink`) for contrast; bars and bricks keep `--effort`. |

### Still open

- Difficulty scale (stars vs labels) — check the ebook's key page.
- Calibration of the difficulty → rating table.
- XP-per-bag milestone (after two weeks of data).
- Season puzzle-count thresholds (after the first fortnight).
- Total bag count of the chosen Lego set.
