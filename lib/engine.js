// The replay engine.
//
// Nothing derived is ever stored. Given the raw facts (puzzles, attempts, config
// history, manual awards) this walks every event in time order and recomputes
// rating, XP, divisions, badges, bags and season progress. A grade correction or a
// config edit is therefore just "change a row and replay".
//
// Pure function: no I/O, no clock reads (pass `now`).

import { makeConfigAt, puzzleRatingFor } from './config.js';
import { SCORE, effectiveGrade } from './grading.js';
import { ukDate, ukMonth, nextMonth, secondsBetween } from './time.js';
import { DIVISIONS, TOP, bandIndex } from './divisions.js';

export const bool = (v) => v === true || v === 1 || /^(true|1|yes)$/i.test(String(v ?? '').trim());

function num(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function finalGradeOf(attempt) {
  return effectiveGrade(attempt.coach_grade || attempt.auto_grade, bool(attempt.hint_used)) || 'wrong';
}

/**
 * @param {object} data  { puzzles, attempts, config, awards }
 * @param {object} opts  { now: ISO string, asOf?: ISO string (defaults to now) }
 */
export function runLeague(data, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const asOf = opts.asOf || now;
  const configAt = makeConfigAt(data.config || []);
  const puzzles = new Map((data.puzzles || []).map((p) => [String(p.id), p]));

  const attempts = (data.attempts || [])
    .filter((a) => a.status === 'finished' && a.finished_at && a.finished_at <= asOf)
    .sort((a, b) => cmp(a.finished_at, b.finished_at) || cmp(String(a.id), String(b.id)));
  const awards = (data.awards || []).filter((w) => w.created_at && w.created_at <= asOf && !w.voided_at);

  const events = [
    ...attempts.map((a) => ({ t: a.finished_at, kind: 'attempt', a })),
    ...awards.map((w) => ({ t: w.created_at, kind: 'award', w })),
  ].sort((x, y) => cmp(x.t, y.t));

  const startCfg = configAt(events.length ? events[0].t : asOf);
  let rating = startCfg.start_rating ?? 1700;
  let gradedCount = 0;
  let xp = 0;
  let division = bandIndex(rating);
  const launchDivision = division;
  let maxDivision = division;
  let monthsBelow = 0;
  let hatRun = 0;
  let bagAcc = 0;
  let bags = 0;
  let lastEventAt = null;

  const badges = [];
  const promotions = [];
  const relegations = [];
  const bagReleases = [];
  const results = [];
  const resultById = new Map();
  const ratingSeries = [{ t: null, rating }];
  const months = new Map();
  const days = new Map();
  const manualAwards = [];
  const seen = new Set();

  let curDay = null;
  let curMonth = null;
  let day = null;

  function openMonth(key) {
    months.set(key, { key, startRating: rating, endRating: null, firstAttempts: 0, fulls: 0, xp: 0 });
  }
  function openDay(key) {
    day = { date: key, xp: 0, firstAttempts: 0, wrong: 0, bonuses: [], lastAt: null, closed: false };
    days.set(key, day);
    hatRun = 0; // a hat-trick run lives inside one session (day)
  }

  function grant(amount, cfg, at) {
    const want = Math.max(0, Math.round(Number(amount) || 0));
    const cap = cfg.daily_xp_cap;
    const room = cap === null || cap === undefined ? Infinity : Math.max(0, cap - day.xp);
    const got = Math.min(want, room);
    day.xp += got;
    xp += got;
    months.get(curMonth).xp += got;
    bagAcc += got;
    const ms = cfg.bag_xp_milestone;
    const total = cfg.bag_total;
    if (ms && ms > 0) {
      while (bagAcc >= ms && (total === null || total === undefined || bags < total)) {
        bagAcc -= ms;
        bags += 1;
        bagReleases.push({ n: bags, at });
      }
    }
    return got;
  }

  function closeDay() {
    if (!day || day.closed) return;
    const cfg = configAt(day.lastAt || lastEventAt || asOf);
    const min = cfg.session_min_attempts ?? 0;
    if (day.firstAttempts > 0 && day.firstAttempts >= min && day.wrong === 0 && cfg.bonus_clean_sheet) {
      const got = grant(cfg.bonus_clean_sheet, cfg, day.lastAt);
      day.bonuses.push({ key: 'clean_sheet', label: 'Clean sheet', xp: cfg.bonus_clean_sheet, awarded: got });
    }
    day.closed = true;
  }

  function closeMonth(key) {
    const m = months.get(key);
    m.endRating = rating;
    const cfg = configAt(lastEventAt || asOf);
    if (division > 0 && rating < DIVISIONS[division].floor) monthsBelow += 1;
    else monthsBelow = 0;
    if (monthsBelow >= (cfg.relegation_months || 2)) {
      relegations.push({ from: division, to: division - 1, month: key });
      division -= 1; // exactly one division, however far the rating fell
      monthsBelow = 0;
    }
  }

  function advanceTo(t) {
    const d = ukDate(t);
    const m = ukMonth(t);
    if (curDay !== null && d !== curDay) closeDay();
    if (curMonth === null) {
      curMonth = m;
      openMonth(m);
    } else {
      while (curMonth < m) {
        closeMonth(curMonth);
        curMonth = nextMonth(curMonth);
        openMonth(curMonth);
      }
    }
    if (d !== curDay) {
      curDay = d;
      openDay(d);
    }
  }

  function checkPromotion(at) {
    while (division < TOP && rating >= DIVISIONS[division + 1].floor) {
      division += 1;
      monthsBelow = 0;
      promotions.push({ to: division, at });
      if (division > maxDivision) {
        maxDivision = division;
        badges.push({ division, key: DIVISIONS[division].key, at });
      }
    }
  }

  function processAttempt(a) {
    const cfg = configAt(a.finished_at);
    const pid = String(a.puzzle_id);
    const first = !seen.has(pid);
    seen.add(pid);
    const hint = bool(a.hint_used);
    const selfCall = bool(a.self_called_wrong);
    const grade = finalGradeOf(a);
    const elapsed = a.started_at ? Math.max(0, secondsBetween(a.started_at, a.finished_at)) : null;
    const clock = num(a.clock_seconds);

    const r = {
      id: a.id,
      puzzle_id: pid,
      at: a.finished_at,
      first,
      reattempt: !first,
      grade,
      autoGrade: a.auto_grade || null,
      coachGrade: a.coach_grade || null,
      provisional: !a.coach_grade,
      hintCapped: hint && (a.coach_grade || a.auto_grade) === 'full',
      hint,
      selfCall,
      elapsed,
      clock,
      xp: 0,
      bonuses: [],
    };

    if (!first) {
      results.push(r);
      resultById.set(a.id, r);
      return; // re-attempts: no XP, no rating, no counts, no bonuses
    }

    let pr = num(a.puzzle_rating);
    if (pr === null) pr = puzzleRatingFor(cfg, puzzles.get(pid)?.difficulty);
    if (pr === null) pr = rating;

    const before = rating;
    const E = 1 / (1 + 10 ** ((pr - before) / 400));
    const K = gradedCount < (cfg.k_early_count ?? 30) ? cfg.k_early ?? 40 : cfg.k_late ?? 24;
    const S = SCORE[grade];
    const delta = K * (S - E);
    rating = before + delta;
    gradedCount += 1;
    ratingSeries.push({ t: a.finished_at, rating });
    checkPromotion(a.finished_at);

    const band = cfg.xp_band ?? 150;
    const tier = pr < before - band ? 'below' : pr > before + band ? 'above' : 'level';
    const base = cfg[`xp_base_${tier}`] ?? 0;
    const mult = cfg[`xp_mult_${grade}`] ?? 0;
    const gradeXp = Math.round(base * mult);

    const bonuses = [];
    if (clock && clock > 0 && elapsed !== null && elapsed <= clock && grade === 'full' && cfg.bonus_clock) {
      bonuses.push({ key: 'clock', label: 'Beat the clock', xp: cfg.bonus_clock });
    }
    if (selfCall && grade === 'wrong' && cfg.bonus_called_it) {
      bonuses.push({ key: 'called_it', label: 'Called it himself', xp: cfg.bonus_called_it });
    }
    if (grade === 'full') {
      hatRun += 1;
      if (hatRun === 3) {
        if (cfg.bonus_hat_trick) bonuses.push({ key: 'hat_trick', label: 'Hat-trick', xp: cfg.bonus_hat_trick });
        hatRun = 0;
      }
    } else {
      hatRun = 0;
    }

    day.firstAttempts += 1;
    if (grade === 'wrong') day.wrong += 1;
    day.lastAt = a.finished_at;
    const m = months.get(curMonth);
    m.firstAttempts += 1;
    if (grade === 'full') m.fulls += 1;

    const requested = gradeXp + bonuses.reduce((s, b) => s + b.xp, 0);
    const got = grant(requested, cfg, a.finished_at);

    Object.assign(r, {
      puzzleRating: pr,
      ratingBefore: before,
      ratingAfter: rating,
      expected: E,
      k: K,
      delta,
      tier,
      base,
      mult,
      gradeXp,
      bonuses,
      requested,
      xp: got,
      capped: requested - got,
    });
    results.push(r);
    resultById.set(a.id, r);
  }

  for (const ev of events) {
    advanceTo(ev.t);
    lastEventAt = ev.t;
    if (ev.kind === 'attempt') processAttempt(ev.a);
    else {
      const w = ev.w;
      const cfg = configAt(w.created_at);
      const want = Math.max(0, Math.round(Number(w.xp) || 0));
      const got = grant(want, cfg, w.created_at);
      manualAwards.push({ id: w.id, at: w.created_at, xp: want, awarded: got, note: w.note || '', by: w.by || '' });
    }
  }
  advanceTo(asOf); // closes finished days and months up to now

  const cfgNow = configAt(asOf);
  const today = days.get(ukDate(asOf));

  return {
    asOf,
    rating,
    gradedCount,
    xp,
    division,
    maxDivision,
    launchDivision,
    monthsBelow,
    badges,
    promotions,
    relegations,
    bags: { released: bags, acc: bagAcc, releases: bagReleases },
    results,
    resultById,
    ratingSeries,
    months: [...months.values()],
    days: [...days.values()],
    manualAwards,
    today: {
      date: today.date,
      xp: today.xp,
      firstAttempts: today.firstAttempts,
      wrong: today.wrong,
      cleanSheetMin: cfgNow.session_min_attempts ?? 0,
    },
    config: cfgNow,
    configAt,
  };
}
