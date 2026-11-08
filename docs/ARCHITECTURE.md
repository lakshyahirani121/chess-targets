# Puzzle League — architecture

How the system in `puzzle-league-design.md` is built. The design doc says *what*; this says *how*.

## 1. Shape

```
 Student / Coach browser
   │   static page: public/index.html + app.js + anim.js + styles.css
   │   (no rating, no answers in the page — everything comes from the API, filtered by role)
   ▼
 Vercel
   ├─ public/            static files
   └─ api/index.js       ONE serverless function; vercel.json rewrites /api/* to it
        │
        ├─ lib/auth.js        password login → signed session cookie (HMAC)
        ├─ lib/router.js      routes, role checks, input validation
        ├─ lib/engine.js      pure replay engine: attempts + config → rating, XP, divisions, rewards
        ├─ lib/grading.js     notation normaliser + auto-check against the answer key
        ├─ lib/views.js       builds the coach payload and the (rating-free) student payload
        ├─ lib/notify.js      optional webhook to n8n when an attempt is submitted
        └─ lib/store/         storage adapters, same interface:
              sheets.js  → Google Sheets (production)
              file.js    → JSON file (local development)
              memory.js  → in-memory (tests)
   ▼
 Google Sheet (owned by the coach; shared with a service account, NEVER with the student)
   tabs: puzzles · attempts · config · awards · handovers
```

No framework and no npm dependencies. Google auth is a hand-signed service-account JWT (Node `crypto`), and Sheets is called over its REST API with `fetch`. Nothing to keep updated, and it fits Vercel's free tier: one function.

## 2. Core idea: store facts, derive everything else

The Sheet holds only things that **happened**:

| Tab | One row per | Key columns |
|---|---|---|
| `puzzles` | book puzzle | `id` (`4.7`), `set`, `number`, `difficulty`, `answer`, `hint`, `clock_seconds` |
| `attempts` | Start press | `started_at`, `finished_at` (server time), `line`, `objective`, `hint_used`, `self_called_wrong`, `auto_grade`, `coach_grade`, `puzzle_rating` and `clock_seconds` snapshots |
| `config` | config *change* | `key`, `value`, `effective_from` — append-only history |
| `awards` | manual XP award by a coach | `xp`, `note` |
| `handovers` | physical reward given | `kind` (badge/bag), `item`, `voided_at` |

Rating, XP, divisions, badges, bags and season progress are **never stored**. On every request, `engine.js` replays all attempts in order and recomputes them. With one student, that's a few thousand rows at most and takes milliseconds.

This one decision handles most of the hard requirements in the design:

| Requirement | Why replay solves it |
|---|---|
| Coach can change any grade at any time | Change one cell; the next replay recomputes rating, XP, bonuses, cap, promotions. |
| Config edits apply forward only | Config is a dated history; the engine reads the value *in effect at each attempt's time*. Each attempt also snapshots its puzzle rating and clock time. |
| Physical rewards are never taken back | Displayed rewards = what the replay derives ∪ what the `handovers` tab says was handed over. |
| Relegation after two month-ends below the band | The replay walks month boundaries (UK time) and counts. No cron job. |
| Clean sheet is per day, daily cap per day | The replay walks UK calendar days. No cron job. |

Because no scheduled job is needed, **n8n is optional**. Its only role is pushing a "new attempt to review" message to the coaches (Telegram, email, WhatsApp…), which keeps grading fast.

## 3. Request flows

**Student attempt**

1. `POST /api/attempts/start {puzzle_id}` → server writes an `open` attempt with `started_at` = server clock. If an open attempt already exists for that puzzle, it is returned instead, so pressing Start again does not reset the clock.
2. Student solves on the board, types the line.
3. `POST /api/attempts/finish {id, line, objective, hint_used, self_called_wrong}` → server stamps `finished_at`, snapshots the puzzle rating from the config in effect, auto-grades against the answer key, saves, fires the n8n webhook.
4. Response: provisional grade, XP for this attempt (from a fresh replay) and the book answer.

**Coach review**

`GET /api/state` returns the verification queue (first attempts with no `coach_grade`). One tap sends `POST /api/coach/grade {id, grade}`, which writes `coach_grade`. Re-grading later is the same call.

## 4. Keeping secrets from the student

- `views.js` builds the student payload from an **allow-list** of fields: never rating, expected score, Elo delta, puzzle rating, band edges or the difficulty table.
- Division progress is sent as a step index + word only (*Just started / Halfway there / Getting close / Almost there*).
- Answers are sent only for puzzles the student has already finished at least once.
- Tests assert the student JSON contains no `rating` key and no rating value.
- The Sheet is reachable only with the service-account key, which exists only in Vercel environment variables.

## 5. Engine rules (implementation decisions)

Where the design doc left a mechanical detail open, the engine does this (all recorded in the design doc's decision log):

- **Provisional grades count immediately.** The student sees XP right after Finish; a coach change re-runs the replay.
- **Hint cap is enforced by the engine**, so even a coach "Full" on a hinted attempt scores 0.5.
- **XP is rounded to whole numbers** per attempt (e.g. 5 × 0.5 = 2.5 → 3).
- **Hat-trick:** every third consecutive Full within a day pays +10, then the run restarts. A Partial or Wrong resets it. Re-attempts are ignored.
- **Beat the clock:** requires a Full result inside the puzzle's set time.
- **Clean sheet:** awarded when the UK day closes (midnight), so a later wrong answer that day can't take back XP already shown.
- **Daily cap** applies in time order. Clean sheet is added last, so it can be clipped by the cap.
- **Bags:** XP accumulates toward the next bag; when the milestone is unset, it keeps accumulating and bags start releasing once it's set.
- **Unresolved values** (bag milestone, bag total, season thresholds) are blank by default and shown as "not set" — never invented.

## 6. Auth

- Three passwords in environment variables (`COACH1_PASSWORD`, `COACH2_PASSWORD`, `STUDENT_PASSWORD`). The login page asks only for a password; which one matches decides the account.
- Session cookie: `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS, HMAC-signed with `SESSION_SECRET`, 30 days.
- All writes require `Content-Type: application/json`, which a cross-site form cannot send, so this plus `SameSite` covers CSRF.

## 7. Frontend

A single page with no build step. `app.js` fetches `/api/state` and renders by role. Coaches get a view switch that loads the student payload, so they can see exactly what he sees. `anim.js` runs the 3.74 s **Play session** sequence from a `replay` object the server sends (state before vs. after the latest session), with a reduced-motion path.

## 8. Testing

- `node --test`, with no test framework.
  - Engine: hand-worked Elo cases, K switch at 30, XP tiers, cap, every bonus, re-attempts, promotion, two-month relegation, grade-correction replay, forward-only config, reward persistence.
  - API: through the memory store — role enforcement, no rating or answer leaks, server-side timer.
  - Sheets adapter: against a local fake of the Google token and Sheets endpoints.
- `npm run dev` runs the whole app locally on a JSON file store.
