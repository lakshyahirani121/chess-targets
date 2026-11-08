// Builds the JSON each role receives.
//
// The student payload is built from an explicit allow-list. It never contains the
// rating, expected score, Elo delta, puzzle ratings, band edges or the difficulty
// table, and answers only for puzzles he has already finished.

import { runLeague, bool } from './engine.js';
import { CONFIG_SPEC } from './config.js';
import { DIVISIONS, TOP, progressFraction, progressStep, STEP_WIDTH } from './divisions.js';
import { ukDate, ukMonth, monthLabel } from './time.js';

const byPuzzleId = (a, b) => {
  const [as, an] = String(a.id).split('.').map(Number);
  const [bs, bn] = String(b.id).split('.').map(Number);
  return as - bs || an - bn || String(a.id).localeCompare(String(b.id));
};

const activeHandovers = (data) => (data.handovers || []).filter((h) => !h.voided_at);

function rewardsState(data, league) {
  const handed = activeHandovers(data);
  const handedBadges = new Set(handed.filter((h) => h.kind === 'badge').map((h) => h.item));
  const handedBags = handed.filter((h) => h.kind === 'bag').map((h) => Number(h.item)).filter(Number.isFinite);
  const handedBagMax = handedBags.length ? Math.max(...handedBags) : 0;
  const bagsReleased = Math.max(league.bags.released, handedBagMax);

  const badges = DIVISIONS.map((d, i) => ({
    key: d.key,
    name: d.name,
    numeral: d.numeral,
    earned: i <= league.maxDivision || handedBadges.has(d.key),
  }));

  const pending = [];
  for (const b of league.badges) {
    if (!handedBadges.has(b.key)) pending.push({ kind: 'badge', item: b.key, label: `${DIVISIONS[b.division].name} collectible`, earnedAt: b.at });
  }
  const handedBagSet = new Set(handedBags);
  for (const r of league.bags.releases) {
    if (!handedBagSet.has(r.n)) pending.push({ kind: 'bag', item: String(r.n), label: `Lego bag ${r.n}`, earnedAt: r.at });
  }
  return { badges, bagsReleased, handedBagMax, pending, handed };
}

function bagsBlock(league, rewards, { coach, now }) {
  const cfg = league.config;
  const milestone = cfg.bag_xp_milestone && cfg.bag_xp_milestone > 0 ? cfg.bag_xp_milestone : null;
  const total = cfg.bag_total && cfg.bag_total > 0 ? cfg.bag_total : null;
  const released = rewards.bagsReleased;
  const complete = total !== null && released >= total;
  let xpToNext = null;
  let progress = 0;
  if (milestone && !complete) {
    const extra = Math.max(0, released - league.bags.released) * milestone; // handed over ahead of XP (after a correction)
    xpToNext = Math.max(0, Math.ceil(extra + (milestone - league.bags.acc)));
    progress = extra > 0 ? 0 : Math.min(1, league.bags.acc / milestone);
  }
  const page = released > 0 ? Math.floor((released - (complete ? 1 : 0)) / 9) : 0;
  const block = {
    milestoneSet: milestone !== null,
    released,
    total,
    remaining: total !== null ? Math.max(0, total - released) : null,
    complete,
    xpToNext,
    progress,
    strip: { firstBag: page * 9 + 1, filled: Math.max(0, Math.min(9, released - page * 9)) },
  };
  if (coach) {
    const since = Date.parse(now) - 14 * 86400_000;
    const recent = league.days.filter((d) => Date.parse(`${d.date}T12:00:00Z`) >= since).reduce((s, d) => s + d.xp, 0);
    const xpPerDay = recent / 14;
    block.milestone = milestone;
    block.xpLast14Days = recent;
    block.pace = milestone && xpPerDay > 0
      ? { bagsPerWeek: (7 * xpPerDay) / milestone, daysToNext: xpToNext !== null ? xpToNext / xpPerDay : null }
      : null;
    block.suggestedMilestone = recent > 0 ? Math.round((recent / 2)) : null; // ≈ one bag per week at the last fortnight's pace
  }
  return block;
}

function seasonBlock(league, { coach, now }) {
  const key = ukMonth(now);
  const m = league.months.find((x) => x.key === key) || { startRating: league.rating, firstAttempts: 0, fulls: 0, xp: 0 };
  const cfg = league.config;
  const count = m.firstAttempts;
  const fullPct = count ? Math.round((m.fulls / count) * 100) : 0;
  const gain = league.rating - m.startRating;
  const countPart = (target) => ({ kind: 'count', label: 'Puzzles', value: count, target: target ?? null, notSet: target == null, met: target != null && count >= target });
  // The student sees plain-language labels; the word "rating" never reaches his screen.
  const ratingHeld = { kind: 'flag', label: coach ? 'Rating not below month start' : 'Held your level this month', met: gain >= 0 };
  const ratingUp = { kind: 'flag', label: coach ? `Rating up ${cfg.season_silverware_gain ?? 40}` : 'A real step up in level', met: gain >= (cfg.season_silverware_gain ?? 40) };
  const fullPart = { kind: 'pct', label: 'Full results', value: fullPct, target: cfg.season_silverware_full_pct ?? 60, met: count > 0 && fullPct >= (cfg.season_silverware_full_pct ?? 60) };
  const tiers = [
    { key: 'survival', label: 'Survival', parts: [countPart(cfg.season_survival_count)] },
    { key: 'par', label: 'Par', parts: [countPart(cfg.season_par_count), ratingHeld] },
    { key: 'silverware', label: 'Silverware', parts: [countPart(cfg.season_silverware_count), ratingUp, fullPart] },
  ].map((t) => ({ ...t, met: t.parts.every((p) => p.met) }));
  const out = { month: key, label: monthLabel(key), puzzles: count, fullPct, xp: m.xp, tiers };
  if (coach) Object.assign(out, { startRating: m.startRating, ratingGain: gain });
  return out;
}

function ladder(league, { coach }) {
  return DIVISIONS.map((d, i) => {
    const state = i === league.division ? 'current' : i <= league.maxDivision ? 'held' : 'locked';
    const row = { index: i, key: d.key, name: d.name, numeral: d.numeral, state };
    if (coach) row.band = d.band;
    return row;
  }).reverse();
}

function lastSession(data, league, now) {
  const finished = (data.attempts || []).filter((a) => a.status === 'finished' && a.finished_at).sort((a, b) => (a.finished_at < b.finished_at ? -1 : 1));
  if (!finished.length) return null;
  const last = finished[finished.length - 1];
  const day = ukDate(last.finished_at);
  const firstOfDay = finished.find((a) => ukDate(a.finished_at) === day);
  const cutoff = new Date(Date.parse(firstOfDay.finished_at) - 1).toISOString();
  const before = runLeague(data, { now: cutoff });
  const puzzle = (data.puzzles || []).find((p) => String(p.id) === String(last.puzzle_id));
  const r = league.resultById.get(last.id);
  const beforeRewards = rewardsState({ handovers: [] }, before);
  const afterRewards = rewardsState(data, league);
  const beforeBadges = new Set(beforeRewards.badges.filter((b) => b.earned).map((b) => b.key));
  return {
    date: day,
    before,
    card: {
      puzzle_id: String(last.puzzle_id),
      set: puzzle?.set || String(last.puzzle_id).split('.')[0],
      difficulty: Number(puzzle?.difficulty) || 0,
      grade: r?.grade || 'wrong',
      provisional: !!r?.provisional,
      reattempt: !!r?.reattempt,
    },
    xp: { from: before.xp, to: league.xp },
    division: { from: before.division, to: league.division },
    promoted: league.division > before.division,
    newBadges: afterRewards.badges.filter((b) => b.earned && !beforeBadges.has(b.key)).map((b) => b.key),
    bags: { from: beforeRewards.bagsReleased, to: afterRewards.bagsReleased },
  };
}

function replayFor(session, league, { coach }) {
  if (!session) return null;
  const { before } = session;
  const out = {
    date: session.date,
    card: session.card,
    xp: session.xp,
    division: session.division,
    promoted: session.promoted,
    newBadges: session.newBadges,
    bags: session.bags,
  };
  if (coach) {
    out.rating = { from: before.rating, to: league.rating };
    out.fraction = { from: progressFraction(before.rating, before.division), to: progressFraction(league.rating, league.division) };
  } else {
    const a = progressStep(before.rating, before.division);
    const b = progressStep(league.rating, league.division);
    out.step = { from: a.index, to: b.index };
  }
  return out;
}

function historyEntry(r, attempt, puzzle, { coach }) {
  const e = {
    id: r.id,
    puzzle_id: r.puzzle_id,
    difficulty: Number(puzzle?.difficulty) || 0,
    at: r.at,
    grade: r.grade,
    provisional: r.provisional,
    reattempt: r.reattempt,
    hint: r.hint,
    selfCall: r.selfCall,
    elapsed: r.elapsed !== null ? Math.round(r.elapsed) : null,
    clock: r.clock,
    xp: r.xp,
    bonuses: r.bonuses.map((b) => ({ label: b.label, xp: b.xp })),
    capped: r.capped || 0,
    line: attempt.line,
    objective: attempt.objective,
    answer: puzzle?.answer || '',
  };
  if (coach) {
    Object.assign(e, {
      autoGrade: r.autoGrade,
      autoReason: attempt.auto_reason,
      coachGrade: r.coachGrade,
      gradedBy: attempt.graded_by,
      gradedAt: attempt.graded_at,
      hintCapped: r.hintCapped,
      puzzleRating: r.puzzleRating ?? null,
      expected: r.expected ?? null,
      k: r.k ?? null,
      delta: r.delta ?? null,
      ratingAfter: r.ratingAfter ?? null,
      tier: r.tier ?? null,
    });
  }
  return e;
}

export function buildView(data, viewer, { now, as } = {}) {
  now = now || new Date().toISOString();
  const coach = viewer.role === 'coach' && as !== 'student';
  const league = runLeague(data, { now });
  const rewards = rewardsState(data, league);
  const puzzles = new Map((data.puzzles || []).map((p) => [String(p.id), p]));
  const attemptsById = new Map((data.attempts || []).map((a) => [a.id, a]));
  const session = lastSession(data, league, now);

  const history = league.results
    .slice()
    .reverse()
    .slice(0, coach ? 1000 : 300)
    .map((r) => historyEntry(r, attemptsById.get(r.id), puzzles.get(r.puzzle_id), { coach }));

  const bonusLog = [
    ...league.days.flatMap((d) => d.bonuses.map((b) => ({ at: d.date, label: b.label, xp: b.awarded }))),
    ...league.manualAwards.map((w) => ({ at: w.at, label: w.note ? `Coach award: ${w.note}` : 'Coach award', xp: w.awarded, ...(coach ? { id: w.id, by: w.by, requested: w.xp } : {}) })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  const open = (data.attempts || [])
    .filter((a) => a.status === 'open')
    .map((a) => ({ id: a.id, puzzle_id: a.puzzle_id, started_at: a.started_at, clock: Number(a.clock_seconds) || null }));

  const step = progressStep(league.rating, league.division);
  const base = {
    role: coach ? 'coach' : 'student',
    viewer: { name: viewer.name, role: viewer.role },
    studentName: process.env.STUDENT_NAME || 'Student',
    serverNow: now,
    today: {
      date: league.today.date,
      xp: league.today.xp,
      cap: league.config.daily_xp_cap,
      puzzles: league.today.firstAttempts,
      cleanSheet: {
        attempts: league.today.firstAttempts,
        needed: league.today.cleanSheetMin,
        onTrack: league.today.firstAttempts > 0 && league.today.wrong === 0,
      },
    },
    xp: league.xp,
    division: {
      index: league.division,
      key: DIVISIONS[league.division].key,
      name: DIVISIONS[league.division].name,
      numeral: DIVISIONS[league.division].numeral,
      top: league.division >= TOP,
      step: { index: step.index, label: step.label, width: STEP_WIDTH[step.index] },
    },
    ladder: ladder(league, { coach }),
    badges: rewards.badges,
    bags: bagsBlock(league, rewards, { coach, now }),
    season: seasonBlock(league, { coach, now }),
    history,
    bonusLog: bonusLog.slice(0, 100),
    openAttempts: open,
    replay: replayFor(session, league, { coach }),
  };

  if (!coach) return base;

  const queue = league.results
    .filter((r) => r.first && r.provisional)
    .map((r) => historyEntry(r, attemptsById.get(r.id), puzzles.get(r.puzzle_id), { coach: true }));

  const last = league.results.filter((r) => r.first).slice(-1)[0] || null;
  return {
    ...base,
    rating: league.rating,
    gradedCount: league.gradedCount,
    lastResult: last ? { puzzle_id: last.puzzle_id, delta: last.delta, expected: last.expected, k: last.k } : null,
    divisionDetail: {
      fraction: progressFraction(league.rating, league.division),
      floor: DIVISIONS[league.division].floor === -Infinity ? null : DIVISIONS[league.division].floor,
      nextFloor: league.division < TOP ? DIVISIONS[league.division + 1].floor : null,
      pointsToNext: league.division < TOP ? DIVISIONS[league.division + 1].floor - league.rating : null,
      belowBand: league.rating < DIVISIONS[league.division].floor,
      monthsBelow: league.monthsBelow,
      relegationMonths: league.config.relegation_months,
      promotions: league.promotions.map((p) => ({ to: DIVISIONS[p.to].name, at: p.at })),
      relegations: league.relegations.map((p) => ({ from: DIVISIONS[p.from].name, to: DIVISIONS[p.to].name, month: p.month })),
    },
    ratingSeries: league.ratingSeries.map((p) => ({ t: p.t, r: Math.round(p.rating * 10) / 10 })),
    queue,
    rewards: {
      pending: rewards.pending,
      handed: rewards.handed.map((h) => ({ id: h.id, kind: h.kind, item: h.item, at: h.handed_over_at, by: h.by })).reverse(),
    },
    config: CONFIG_SPEC.map((c) => ({ key: c.key, label: c.label, group: c.group, value: league.config[c.key], default: c.def })),
    configHistory: (data.config || []).slice().reverse().slice(0, 50),
  };
}

export function puzzleList(data, viewer, { as } = {}) {
  const coach = viewer.role === 'coach' && as !== 'student';
  const finished = (data.attempts || []).filter((a) => a.status === 'finished');
  const attemptedIds = new Set(finished.map((a) => String(a.puzzle_id)));
  const counts = new Map();
  for (const a of finished) counts.set(String(a.puzzle_id), (counts.get(String(a.puzzle_id)) || 0) + 1);
  return (data.puzzles || [])
    .slice()
    .sort(byPuzzleId)
    .map((p) => {
      const id = String(p.id);
      const attempted = attemptedIds.has(id);
      const row = {
        id,
        set: p.set || id.split('.')[0],
        number: p.number || id.split('.')[1] || '',
        difficulty: Number(p.difficulty) || 0,
        clock_seconds: Number(p.clock_seconds) || null,
        attempted,
        attempts: counts.get(id) || 0,
        hasAnswer: !!String(p.answer || '').trim(),
      };
      if (coach) Object.assign(row, { answer: p.answer || '', hint: p.hint || '', notes: p.notes || '' });
      else if (attempted) row.answer = p.answer || '';
      return row;
    });
}

export { bool };
