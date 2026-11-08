// Fills data/local-store.json with DEMO data so you can try the app locally.
// Puzzles and answers here are made up — they are NOT from the book.
// Never touches Google Sheets.   Usage: npm run seed-demo [-- --force]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLeague } from '../lib/engine.js';
import { autoGrade } from '../lib/grading.js';
import { DIVISIONS } from '../lib/divisions.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'data', 'local-store.json');
if (fs.existsSync(file) && !process.argv.includes('--force')) {
  console.log(`${file} already exists. Re-run with --force to overwrite.`);
  process.exit(0);
}

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pickFrom = (arr) => arr[Math.floor(rand() * arr.length)];

const LINES = ['Qh5 g6 Qxe5', 'Nxf7 Kxf7 Qh5', 'Rxe8 Qxe8 Qxh7', 'Bxh7 Kxh7 Ng5', 'Nd5 exd5 Qxe7', 'Rxf7 Kxf7 Qf3', 'Qxh7 Kxh7 Rh3', 'Ne6 fxe6 Qg7'];
const puzzles = [];
for (let set = 1; set <= 8; set++) {
  for (let n = 1; n <= 12; n++) {
    puzzles.push({
      id: `${set}.${n}`, set: String(set), number: String(n),
      difficulty: String(1 + Math.floor(rand() * 5)),
      answer: pickFrom(LINES), hint: 'DEMO hint',
      clock_seconds: rand() < 0.3 ? String(pickFrom([90, 120, 180])) : '',
      notes: 'DEMO — not from the book',
    });
  }
}

const now = new Date();
const config = [
  { key: 'bag_xp_milestone', value: '70', effective_from: new Date(now - 30 * 86400e3).toISOString(), changed_by: 'Coach A' },
  { key: 'bag_total', value: '14', effective_from: new Date(now - 30 * 86400e3).toISOString(), changed_by: 'Coach A' },
  { key: 'season_survival_count', value: '40', effective_from: new Date(now - 30 * 86400e3).toISOString(), changed_by: 'Coach A' },
  { key: 'season_par_count', value: '60', effective_from: new Date(now - 30 * 86400e3).toISOString(), changed_by: 'Coach A' },
  { key: 'season_silverware_count', value: '80', effective_from: new Date(now - 30 * 86400e3).toISOString(), changed_by: 'Coach A' },
];

const attempts = [];
let idx = 0;
const order = puzzles.slice();
function addAttempt(dayOffset, minute, grade, opts = {}) {
  const p = opts.puzzle || order[idx++];
  const finished = new Date(now - dayOffset * 86400e3);
  finished.setUTCHours(17, minute, 0, 0);
  if (finished > now) finished.setTime(now - (60 - minute) * 60e3);
  const started = new Date(finished - (60 + Math.floor(rand() * 240)) * 1000);
  const line = grade === 'full' ? p.answer : grade === 'partial' ? p.answer.split(' ')[0] + ' Kg8 Qd5' : 'Rd1 Qc7';
  const auto = autoGrade(line, p.answer);
  attempts.push({
    id: `demo${String(attempts.length).padStart(4, '0')}`, puzzle_id: p.id, status: 'finished',
    started_at: started.toISOString(), finished_at: finished.toISOString(), line,
    objective: pickFrom(['mate', 'win the queen', 'fork', 'win material', '']),
    hint_used: opts.hint ? 'TRUE' : 'FALSE', self_called_wrong: opts.self ? 'TRUE' : 'FALSE',
    auto_grade: opts.hint && auto.grade === 'full' ? 'partial' : auto.grade, auto_reason: auto.reason,
    coach_grade: opts.confirmed ? (opts.coachGrade || auto.grade) : '', graded_by: opts.confirmed ? 'Coach A' : '',
    graded_at: opts.confirmed ? finished.toISOString() : '',
    puzzle_rating: String({ 1: 1400, 2: 1600, 3: 1800, 4: 2050, 5: 2300 }[p.difficulty]), clock_seconds: p.clock_seconds,
  });
}

for (let day = 18; day >= 1; day--) {
  if (day % 6 === 0) continue; // a rest day
  const n = 3 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const r = rand();
    addAttempt(day, i * 7, r < 0.45 ? 'full' : r < 0.75 ? 'partial' : 'wrong', { confirmed: true, hint: rand() < 0.08, self: rand() < 0.1 });
  }
}
// Today's session: strong results on hard puzzles, left unconfirmed for the queue.
const hard = order.slice(idx).filter((p) => Number(p.difficulty) >= 4).slice(0, 4);
hard.forEach((p, i) => addAttempt(0, i * 6, i === 2 ? 'partial' : 'full', { puzzle: p }));
const used = new Set(attempts.map((a) => a.puzzle_id));
order.splice(0, order.length, ...order.filter((p) => !used.has(p.id)));

const handovers = [{ id: 'h1', kind: 'bag', item: '1', handed_over_at: new Date(now - 10 * 86400e3).toISOString(), by: 'Coach A' }];
const data = { puzzles, attempts, config, awards: [], handovers };
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(data, null, 1));

const s = runLeague(data, { now: now.toISOString() });
console.log(`Wrote ${file}`);
console.log(`DEMO: ${puzzles.length} puzzles, ${attempts.length} attempts. Rating ${s.rating.toFixed(1)}, ${DIVISIONS[s.division].name}, XP ${s.xp}, bags ${s.bags.released}.`);
