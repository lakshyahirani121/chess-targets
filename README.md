# Puzzle League

A private over-the-board puzzle tracker for one chess student and two coaches. The student solves puzzles from Carsten Hansen's *Daily Chess Training: Chess Tactics — Vol. 1* on a real board, then records the line here. The app checks it against the book's answer key, and a coach confirms the grade with one tap.

Each grade feeds two separate numbers:

- **Puzzle rating** (Elo, coaches only) → divisions → physical collectibles
- **Season XP** (student-facing, only grows through play) → Lego bags

| Document | What's in it |
|---|---|
| [`puzzle-league-design.md`](puzzle-league-design.md) | The design spec and decision log |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How it's built |
| [`docs/SETUP.md`](docs/SETUP.md) | **Step-by-step setup**: Google Sheet, Vercel, loading puzzles, n8n |

## Stack

- Static page plus one Vercel serverless function.
- Google Sheets as the database, accessed only by the server through a service account.
- No npm dependencies and no build step.
- Rating, XP, divisions and rewards are recomputed from the raw attempt log on every request, so grade corrections and config changes just work.

## Commands

```bash
npm test             # engine, grading, API and Sheets-adapter tests
npm run seed-demo    # fill a local JSON store with made-up demo data
npm run dev          # http://localhost:3000 (uses .env.local)
```

## Layout

```
api/index.js          Vercel entry (all /api/* routes)
lib/engine.js         replay engine: rating, XP, bonuses, divisions, bags, season
lib/grading.js        notation normaliser + auto-check against the answer key
lib/views.js          coach payload / rating-free student payload
lib/router.js         routes, auth checks, validation
lib/store/            Google Sheets, local file and in-memory stores
public/               the page (app.js, anim.js, styles.css)
n8n/                  optional "new attempt" notification workflow
test/                 node --test suites
```
