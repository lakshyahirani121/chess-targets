import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLeague } from '../lib/engine.js';

// ---- helpers ---------------------------------------------------------------
let seq = 0;
function att(puzzle_id, finished_at, grade, extra = {}) {
  seq += 1;
  return {
    id: `a${String(seq).padStart(4, '0')}`,
    puzzle_id,
    status: 'finished',
    started_at: extra.started_at || new Date(Date.parse(finished_at) - 60_000).toISOString(),
    finished_at,
    auto_grade: grade,
    coach_grade: extra.coach_grade ?? '',
    hint_used: extra.hint ? 'TRUE' : 'FALSE',
    self_called_wrong: extra.selfCall ? 'TRUE' : 'FALSE',
    puzzle_rating: String(extra.pr ?? 1800),
    clock_seconds: extra.clock ?? '',
  };
}
const t = (day, hh = 10, mm = 0) => `2026-11-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`;
const run = (attempts, now, more = {}) => runLeague({ puzzles: [], attempts, config: [], awards: [], ...more }, { now });
const close = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// ---- Elo -------------------------------------------------------------------
test('Elo: 1700 student, 1800 puzzle, full → +25.603 (K=40)', () => {
  const s = run([att('1.1', t(2), 'full', { pr: 1800 })], t(2, 12));
  const r = s.results[0];
  close(r.expected, 0.359935);
  close(r.delta, 25.6026);
  close(s.rating, 1725.6026);
});

test('Elo: wrong against 1800 → −14.397', () => {
  const s = run([att('1.1', t(2), 'wrong', { pr: 1800 })], t(2, 12));
  close(s.results[0].delta, -14.3974);
  close(s.rating, 1685.6026);
});

test('Elo: partial against 1600 → −5.603', () => {
  const s = run([att('1.1', t(2), 'partial', { pr: 1600 })], t(2, 12));
  close(s.results[0].expected, 0.640065);
  close(s.results[0].delta, -5.6026);
});

test('Elo: chained — second attempt uses the updated rating', () => {
  const s = run([att('1.1', t(2, 10), 'full', { pr: 1800 }), att('1.2', t(2, 11), 'full', { pr: 1800 })], t(2, 12));
  // second: E = 1/(1+10^((1800-1725.6026)/400)) = 0.394541 ; delta = 40*(1-0.394541) = 24.2184
  close(s.results[1].expected, 0.394541, 1e-5);
  close(s.rating, 1749.8210);
});

test('K drops from 40 to 24 after 30 graded puzzles; re-attempts do not count', () => {
  const list = [];
  for (let i = 0; i < 30; i++) list.push(att(`2.${i + 1}`, `2026-11-${String(1 + Math.floor(i / 5)).padStart(2, '0')}T${10 + (i % 5)}:00:00.000Z`, 'partial', { pr: 1700 }));
  list.push(att('2.1', '2026-11-07T09:00:00.000Z', 'full', { pr: 1700 })); // re-attempt
  list.push(att('3.1', '2026-11-07T10:00:00.000Z', 'full', { pr: 1700 }));
  const s = run(list, '2026-11-07T12:00:00.000Z');
  assert.equal(s.results[29].k, 40);
  assert.equal(s.results[30].reattempt, true);
  assert.equal(s.results[31].k, 24);
  assert.equal(s.gradedCount, 31);
});

test('Hint caps a coach "full" at 0.5', () => {
  const s = run([att('1.1', t(2), 'full', { pr: 1600, hint: true, coach_grade: 'full' })], t(2, 12));
  assert.equal(s.results[0].grade, 'partial');
  assert.equal(s.results[0].hintCapped, true);
  close(s.results[0].delta, -5.6026);
});

// ---- XP --------------------------------------------------------------------
test('XP tiers and multipliers (rounded to whole XP)', () => {
  const cases = [
    [1400, 'full', 5], [1400, 'partial', 3], [1400, 'wrong', 1],
    [1600, 'full', 10], [1800, 'partial', 5], [1850, 'wrong', 2],
    [2050, 'full', 18], [2050, 'partial', 9], [2050, 'wrong', 4],
  ];
  for (const [pr, g, want] of cases) {
    const s = run([att('1.1', t(2), g, { pr })], t(2, 12));
    assert.equal(s.results[0].xp, want, `${pr} ${g}`);
  }
});

test('Re-attempt: no XP, no rating change, no monthly count', () => {
  const s = run([att('1.1', t(2, 10), 'wrong', { pr: 1800 }), att('1.1', t(2, 11), 'full', { pr: 1800 })], t(2, 12));
  assert.equal(s.results[1].xp, 0);
  assert.equal(s.results[1].reattempt, true);
  close(s.rating, 1685.6026);
  assert.equal(s.months[0].firstAttempts, 1);
});

test('Hat-trick: +10 on every third consecutive full, run resets on partial', () => {
  const g = ['full', 'full', 'full', 'full', 'partial', 'full', 'full', 'full'];
  const s = run(g.map((x, i) => att(`4.${i + 1}`, t(3, 9, i * 5), x, { pr: 1600 })), t(3, 12));
  const hats = s.results.filter((r) => r.bonuses.some((b) => b.key === 'hat_trick')).map((r) => r.puzzle_id);
  assert.deepEqual(hats, ['4.3', '4.8']);
});

test('Hat-trick does not carry across days', () => {
  const s = run([att('4.1', t(3, 20), 'full', { pr: 1600 }), att('4.2', t(3, 21), 'full', { pr: 1600 }), att('4.3', t(4, 9), 'full', { pr: 1600 })], t(4, 12));
  assert.equal(s.results.flatMap((r) => r.bonuses).length, 0);
});

test('Clean sheet: awarded at day close, needs 5 first attempts and zero wrong', () => {
  const five = [1, 2, 3, 4, 5].map((i) => att(`5.${i}`, t(4, 10, i), 'partial', { pr: 1600 }));
  const sameDay = run(five, t(4, 23));
  assert.equal(sameDay.days[0].bonuses.length, 0, 'not yet — day still open');
  const nextDay = run(five, t(5, 9));
  assert.deepEqual(nextDay.days[0].bonuses.map((b) => b.key), ['clean_sheet']);
  assert.equal(nextDay.xp, sameDay.xp + 15);

  const four = five.slice(0, 4);
  assert.equal(run(four, t(5, 9)).days[0].bonuses.length, 0);

  const withWrong = [...four, att('5.9', t(4, 11), 'wrong', { pr: 1600 })];
  assert.equal(run(withWrong, t(5, 9)).days[0].bonuses.length, 0);
});

test('Beat the clock: Full inside the set time only', () => {
  const inTime = att('6.1', t(5, 10), 'full', { pr: 1600, clock: '120', started_at: t(5, 9, 58) + '' });
  const s1 = run([{ ...inTime, started_at: '2026-11-05T09:58:30.000Z' }], t(5, 12));
  assert.ok(s1.results[0].bonuses.some((b) => b.key === 'clock'));
  const slow = { ...inTime, started_at: '2026-11-05T09:57:00.000Z' };
  assert.ok(!run([slow], t(5, 12)).results[0].bonuses.some((b) => b.key === 'clock'));
  const partial = { ...inTime, started_at: '2026-11-05T09:58:30.000Z', auto_grade: 'partial' };
  assert.ok(!run([partial], t(5, 12)).results[0].bonuses.some((b) => b.key === 'clock'));
  const noClock = { ...inTime, started_at: '2026-11-05T09:58:30.000Z', clock_seconds: '' };
  assert.ok(!run([noClock], t(5, 12)).results[0].bonuses.some((b) => b.key === 'clock'));
});

test('Called it himself: +5 only when he flagged it AND it is wrong', () => {
  const s = run([att('7.1', t(6), 'wrong', { pr: 2050, selfCall: true })], t(6, 12));
  assert.equal(s.results[0].xp, 4 + 5);
  const notWrong = run([att('7.1', t(6), 'partial', { pr: 2050, selfCall: true })], t(6, 12));
  assert.equal(notWrong.results[0].xp, 9);
});

test('Daily cap 120 includes bonuses; resets next UK day', () => {
  const day1 = Array.from({ length: 10 }, (_, i) => att(`8.${i + 1}`, t(7, 9, i * 5), 'full', { pr: 2300 }));
  const s = run([...day1, att('8.20', t(8, 9), 'full', { pr: 2300 })], t(8, 12));
  assert.equal(s.days[0].xp, 120);
  assert.ok(s.results[9].capped > 0);
  assert.equal(s.results[10].xp, 18);
});

test('UK day boundary uses Europe/London (BST): 23:30Z in July is the next UK day', () => {
  const a = att('9.1', '2026-07-01T22:30:00.000Z', 'full', { pr: 1600 }); // 23:30 BST, 1 July
  const b = att('9.2', '2026-07-01T23:30:00.000Z', 'full', { pr: 1600 }); // 00:30 BST, 2 July
  const s = run([a, b], '2026-07-02T12:00:00.000Z');
  assert.deepEqual(s.days.map((d) => d.date), ['2026-07-01', '2026-07-02']);
});

test('Manual coach award counts toward the daily cap', () => {
  const s = run([att('1.1', t(2), 'full', { pr: 1600 })], t(2, 12), {
    awards: [{ id: 'w1', created_at: t(2, 11), xp: '200', note: 'bonus' }],
  });
  assert.equal(s.xp, 120);
  assert.equal(s.manualAwards[0].awarded, 110);
});

// ---- grade corrections & config --------------------------------------------
test('Grade correction replays rating and XP', () => {
  const a1 = att('1.1', t(2, 10), 'full', { pr: 1800 });
  const a2 = att('1.2', t(2, 11), 'full', { pr: 1800 });
  const before = run([a1, a2], t(2, 12));
  const after = run([{ ...a1, coach_grade: 'wrong' }, a2], t(2, 12));
  close(after.results[0].delta, -14.3974);
  assert.notEqual(after.results[1].delta, before.results[1].delta, 'later attempt recomputed from the new rating');
  assert.ok(after.xp < before.xp, 'XP can go down after a correction');
});

test('Config edits apply forward only', () => {
  const a1 = att('1.1', t(2, 10), 'full', { pr: 2300 });
  const a2 = att('1.2', t(3, 10), 'full', { pr: 2300 });
  const config = [{ key: 'xp_base_above', value: '30', effective_from: t(2, 12) }];
  const s = run([a1, a2], t(3, 12), { config });
  assert.equal(s.results[0].xp, 18);
  assert.equal(s.results[1].xp, 30);
});

// ---- divisions ---------------------------------------------------------------
test('Promotion is immediate and earns a badge once', () => {
  const list = Array.from({ length: 5 }, (_, i) => att(`10.${i + 1}`, t(9, 9 + i), 'full', { pr: 1800 }));
  const s = run(list, t(9, 18));
  assert.ok(s.rating >= 1800);
  assert.equal(s.division, 3); // Division 2
  assert.deepEqual(s.badges.map((b) => b.key), ['D2']);
  assert.equal(s.launchDivision, 2);
});

function dropTo(pr, n, dayStart, month = '11') {
  return Array.from({ length: n }, (_, i) =>
    att(`${month}x.${dayStart}.${i}`, `2026-${month}-${String(dayStart).padStart(2, '0')}T${String(8 + (i % 12)).padStart(2, '0')}:00:00.000Z`, 'wrong', { pr }));
}

test('Relegation only after two consecutive month-ends below the band', () => {
  const nov = dropTo(1400, 2, 20); // falls below 1700
  const oneMonth = run(nov, '2026-12-15T12:00:00.000Z');
  assert.ok(oneMonth.rating < 1700);
  assert.equal(oneMonth.division, 2, 'still Division 3 after one bad month');
  assert.equal(oneMonth.monthsBelow, 1);
  const twoMonths = run(nov, '2027-01-02T12:00:00.000Z');
  assert.equal(twoMonths.division, 1, 'relegated to Division 4 after Nov + Dec');
  assert.equal(twoMonths.relegations.length, 1);
});

test('A good month in between resets the relegation count', () => {
  const nov = dropTo(1400, 2, 20);
  const decRecover = Array.from({ length: 4 }, (_, i) => att(`r.${i}`, `2026-12-0${i + 1}T10:00:00.000Z`, 'full', { pr: 2050 }));
  const s = run([...nov, ...decRecover], '2027-01-02T12:00:00.000Z');
  assert.ok(s.rating >= 1700);
  assert.equal(s.division, 2);
});

test('Relegation drops exactly one division even after a big fall', () => {
  const crash = dropTo(1400, 25, 10); // rating far below 1600
  const s = run(crash, '2027-01-02T12:00:00.000Z');
  assert.ok(s.rating < 1600);
  assert.equal(s.division, 1, 'Division 3 → Division 4, not Division 5');
});

test('Re-promotion into a held division earns no new badge', () => {
  const up = Array.from({ length: 5 }, (_, i) => att(`u.${i}`, `2026-11-02T1${i}:00:00.000Z`, 'full', { pr: 1800 }));
  const down = dropTo(1400, 6, 10, '11').map((a, i) => ({ ...a, finished_at: `2026-11-1${i}T10:00:00.000Z`, puzzle_id: `d.${i}` }));
  const upAgain = Array.from({ length: 12 }, (_, i) => att(`v.${i}`, `2027-01-${String(5 + i).padStart(2, '0')}T10:00:00.000Z`, 'full', { pr: 2050 }));
  const s = run([...up, ...down, ...upAgain], '2027-01-31T12:00:00.000Z');
  assert.equal(s.relegations.length, 1);
  assert.ok(s.promotions.length >= 2);
  assert.equal(s.badges.filter((b) => b.key === 'D2').length, 1);
});

// ---- bags -------------------------------------------------------------------
test('Bags release every milestone; capped at the set size; unset milestone accumulates', () => {
  const list = Array.from({ length: 6 }, (_, i) => att(`b.${i}`, t(10, 9 + i), 'full', { pr: 1700 })); // 60 XP + 2 hat-tricks = 80
  const unset = run(list, t(10, 20));
  assert.equal(unset.bags.released, 0);
  assert.equal(unset.bags.acc, 80);
  const cfg = [{ key: 'bag_xp_milestone', value: '25', effective_from: '2026-01-01T00:00:00.000Z' }];
  const s = run(list, t(10, 20), { config: cfg });
  assert.equal(s.bags.released, 3);
  assert.equal(s.bags.acc, 5);
  const capped = run(list, t(10, 20), { config: [...cfg, { key: 'bag_total', value: '2', effective_from: '2026-01-01T00:00:00.000Z' }] });
  assert.equal(capped.bags.released, 2);
});

test('Season months track start rating, first attempts and fulls', () => {
  const s = run([att('1.1', t(2), 'full', { pr: 1800 }), att('1.2', t(3), 'wrong', { pr: 1800 })], '2026-12-02T10:00:00.000Z');
  assert.equal(s.months.length, 2);
  assert.equal(s.months[0].startRating, 1700);
  assert.equal(s.months[0].firstAttempts, 2);
  assert.equal(s.months[0].fulls, 1);
  close(s.months[1].startRating, s.rating);
});
