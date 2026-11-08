# Puzzle League — setup guide

From zero to a working system. Allow about 30 minutes. You need a Google account, a GitHub account (you have one) and a free Vercel account.

---

## Part A — Google Sheet (≈10 min)

The Sheet is the database. The app creates the tabs and columns itself.

1. Go to <https://sheets.new> and name the sheet **Puzzle League**.
2. Copy the sheet ID from the address bar. It's the long part between `/d/` and `/edit`:
   `https://docs.google.com/spreadsheets/d/`**`1AbC…xyz`**`/edit`
3. Open <https://console.cloud.google.com> and create a project called `puzzle-league` (project picker at the top → **New project**).
4. In that project, go to **APIs & Services → Library**, search for **Google Sheets API** and click **Enable**.
5. Go to **IAM & Admin → Service Accounts → Create service account**. Name it `puzzle-league`, skip the optional role steps, and click **Done**.
6. Click the new service account → **Keys → Add key → Create new key → JSON**. A `.json` file downloads. Treat it like a password.
7. Back in the Sheet, click **Share** and add the service account's email (it looks like `puzzle-league@puzzle-league-123456.iam.gserviceaccount.com`, and is also in the JSON as `client_email`) as an **Editor**. Untick "Notify people".

> **Never share the Sheet with the student's Google account.** He could open it and see the rating and every answer. Coaches can have access.

If step 6 says key creation is disabled, your Google account belongs to an organisation that blocks it. Use a personal Gmail account instead.

---

## Part B — Deploy on Vercel (≈10 min)

1. Go to <https://vercel.com>, sign in with GitHub, then **Add New → Project** and import **lakshyahirani121/chess-targets**.
2. **Framework preset:** *Other*. Leave the build command empty and the root directory as it is.
3. Under **Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `COACH1_NAME` | e.g. `Coach A` |
   | `COACH1_PASSWORD` | a password, at least 8 characters |
   | `COACH2_NAME` | e.g. `Coach B` |
   | `COACH2_PASSWORD` | a *different* password |
   | `STUDENT_NAME` | the student's first name |
   | `STUDENT_PASSWORD` | a *different* password |
   | `SESSION_SECRET` | a long random string, e.g. from <https://www.random.org/strings/> (32+ characters) |
   | `GOOGLE_SHEET_ID` | the ID from Part A step 2 |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | open the downloaded `.json` file in a text editor and paste **all** of it |
   | `APP_URL` | (optional, add after the first deploy) your site URL, e.g. `https://chess-targets.vercel.app` |
   | `N8N_WEBHOOK_URL` | (optional) see Part F |

   Logging in only needs a password. Each password belongs to one account, which is why all three must be different.
4. Click **Deploy**.
5. **Which branch Vercel deploys:** Vercel deploys the repository's default branch. The code currently lives on `claude/gifted-meitner-armfk9`. Either merge it into `main` (ask me to open a pull request), or in Vercel set **Settings → Git → Production Branch** to that branch.
6. Check it works: open `https://<your-site>/api/health`. You want `"ok": true` and `"storage": "google-sheets"`.
7. Open the site and log in with a coach password. The first load creates five tabs in the Sheet: `puzzles`, `attempts`, `config`, `awards`, `handovers`.

---

## Part C — Load the puzzles and answers

The app needs, for each puzzle: the id (`4.7`), the difficulty (1–5) and the book's main line. The hint and a clock time are optional.

**Format** (see `data/puzzles-template.csv`):

```
id,difficulty,answer,hint,clock_seconds,notes
1.1,2,Nxf7+ Kxf7 Qh5+ Kg8 Qd5#,Look at f7,,
1.2,3,Rxe8+ Qxe8 Qxh7#,,120,
1.3,4,Qh5 g6 Qxe5 | Qh5 Nf6 Qxf7#,,,two main lines
```

- Write the **answer** as moves for both sides, in normal algebraic notation. Move numbers, `+`, `#`, `x` and `!?` are ignored when checking, so `1.Nxf7+ Kxf7` and `Nf7 Kf7` count as the same.
- If the book gives more than one main line, separate them with `|`.
- Leave `clock_seconds` empty unless you want a Beat-the-clock bonus on that puzzle.

**From the ebook:** send me the ebook file (PDF or EPUB) in a session and I'll turn it into this CSV. Then spot-check a few answers against the book.

**Import:** log in as a coach → **Admin → Import from CSV** → paste → **Import**. Running it again with the same ids updates those puzzles. You can also add or edit single puzzles under **Admin → Puzzles & answers**.

---

## Part D — Before launch: calibrate (one session)

1. Check the book's key page: is difficulty shown as 1–5 stars? If it uses word labels instead, map them to 1–5 in order.
2. Run a ten-puzzle session across the whole difficulty range. Then adjust **Admin → Settings → Difficulty table** if the ratings feel off.

Settings changes only affect future attempts. Past results keep the values they were scored with.

---

## Part E — After the first two weeks

Some values must come from real data, so they start as **not set**:

| Setting | How to choose it |
|---|---|
| **XP per Lego bag** | The bag panel suggests a number based on the last 14 days, aiming for about one bag a week. |
| **Total bags in the Lego set** | Count the numbered bags in the box. |
| **Survival / Par / Silverware puzzles per month** | Base them on his first fortnight's puzzle count. |

XP he earns before the bag target is set still counts toward bag 1.

---

## Part F — Optional: n8n ping when he submits

When `N8N_WEBHOOK_URL` is set, the app sends a message to n8n each time the student finishes a puzzle, so a coach can grade it straight away.

1. In n8n: **Workflows → Import from file →** `n8n/attempt-notify.workflow.json`.
2. Open the **Notify coaches** node, connect your Telegram bot credentials and set your chat ID. You can swap the node for Email, WhatsApp, Slack and so on — the payload is the same.
3. Activate the workflow and copy the webhook node's **Production URL**.
4. In Vercel, set `N8N_WEBHOOK_URL` to that URL (and `APP_URL` to your site), then redeploy.

The payload contains the puzzle id, his line, what he was playing for, the auto-check grade and a review link. It never contains the rating.

---

## Day to day

**Student**
1. Pick the puzzle number and press **Start** (the clock starts).
2. Solve it on the board.
3. Type the line (both sides' moves) and what he's playing for. Tick *I used the hint* or *I think this is wrong* if they apply.
4. Press **Finish**. He sees a provisional result, his XP and the book's answer.

**Coach**
- Work through the **Verification queue**: one tap per attempt (**Confirm** or change the grade).
- You can change any grade later from **History**; rating and XP recalculate automatically.
- When the **Rewards to hand over** list shows a badge or a bag, give it to him and tap **Handed over**.
- **Award XP** lets you add a manual bonus (e.g. the timer failed). It counts toward the daily cap.
- The **Student view** switch shows exactly what he sees.

---

## Run it on your laptop (optional)

Requires Node.js 20 or newer.

```bash
git clone -b claude/gifted-meitner-armfk9 https://github.com/lakshyahirani121/chess-targets.git
```

```bash
cd chess-targets && cp .env.example .env.local
```

Edit `.env.local` to set the three passwords and `SESSION_SECRET`. Leave the Google lines empty to use a local file instead of the Sheet.

```bash
npm run seed-demo
```

```bash
npm run dev
```

Open <http://localhost:3000>. `npm test` runs the test suite. The demo data is made up and is not from the book.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/api/health` shows `problems` | A password or `SESSION_SECRET` is missing, too short, or two passwords are the same. Fix it in Vercel and redeploy. |
| "Google Sheets 403/404 … shared (Editor) with the service account" | The Sheet isn't shared with the service account email, or `GOOGLE_SHEET_ID` is wrong. |
| "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON" | Paste the entire file, from the first `{` to the last `}`. |
| "Storage is not configured" | `GOOGLE_SHEET_ID` is missing in Vercel. |
| A puzzle id shows as `4.1` instead of `4.10` in the Sheet | Someone typed it into the Sheet directly and Sheets turned it into a number. Edit puzzles through the app, or format that column as plain text. |
| An env var change has no effect | Vercel only applies env changes on the next deploy. Use **Deployments → Redeploy**. |
