// League configuration. Every value is editable by a coach. Edits are stored as a
// dated history (config tab) and apply going forward only: the engine asks for the
// value in effect at the moment of each attempt.

/** Keys, defaults and labels. `null` default = UNRESOLVED in the design doc: shown as "not set". */
export const CONFIG_SPEC = [
  { key: 'start_rating', def: 1700, label: 'Starting rating', group: 'Rating' },
  { key: 'k_early', def: 40, label: 'K factor (early)', group: 'Rating' },
  { key: 'k_early_count', def: 30, label: 'Graded puzzles using early K', group: 'Rating' },
  { key: 'k_late', def: 24, label: 'K factor (after)', group: 'Rating' },

  { key: 'diff_rating_1', def: 1400, label: '1-star puzzle rating', group: 'Difficulty table (provisional — calibrate)' },
  { key: 'diff_rating_2', def: 1600, label: '2-star puzzle rating', group: 'Difficulty table (provisional — calibrate)' },
  { key: 'diff_rating_3', def: 1800, label: '3-star puzzle rating', group: 'Difficulty table (provisional — calibrate)' },
  { key: 'diff_rating_4', def: 2050, label: '4-star puzzle rating', group: 'Difficulty table (provisional — calibrate)' },
  { key: 'diff_rating_5', def: 2300, label: '5-star puzzle rating', group: 'Difficulty table (provisional — calibrate)' },

  { key: 'xp_band', def: 150, label: 'XP band (± rating points)', group: 'XP' },
  { key: 'xp_base_below', def: 5, label: 'Base XP, puzzle below band', group: 'XP' },
  { key: 'xp_base_level', def: 10, label: 'Base XP, puzzle within band', group: 'XP' },
  { key: 'xp_base_above', def: 18, label: 'Base XP, puzzle above band', group: 'XP' },
  { key: 'xp_mult_full', def: 1, label: 'Multiplier, full', group: 'XP' },
  { key: 'xp_mult_partial', def: 0.5, label: 'Multiplier, partial', group: 'XP' },
  { key: 'xp_mult_wrong', def: 0.2, label: 'Multiplier, wrong', group: 'XP' },
  { key: 'daily_xp_cap', def: 120, label: 'Daily XP cap (incl. bonuses)', group: 'XP' },

  { key: 'bonus_clean_sheet', def: 15, label: 'Clean sheet bonus', group: 'Bonuses' },
  { key: 'session_min_attempts', def: 5, label: 'Clean sheet: minimum first attempts in the day', group: 'Bonuses' },
  { key: 'bonus_hat_trick', def: 10, label: 'Hat-trick bonus', group: 'Bonuses' },
  { key: 'bonus_clock', def: 3, label: 'Beat the clock bonus', group: 'Bonuses' },
  { key: 'bonus_called_it', def: 5, label: 'Called it himself bonus', group: 'Bonuses' },

  { key: 'bag_xp_milestone', def: null, label: 'XP per Lego bag (set after two weeks; aim ≈ 1 bag/week)', group: 'Lego' },
  { key: 'bag_total', def: null, label: 'Total bags in the Lego set', group: 'Lego' },

  { key: 'season_survival_count', def: null, label: 'Survival: puzzles per month', group: 'Season (set after first fortnight)' },
  { key: 'season_par_count', def: null, label: 'Par: puzzles per month', group: 'Season (set after first fortnight)' },
  { key: 'season_silverware_count', def: null, label: 'Silverware: puzzles per month', group: 'Season (set after first fortnight)' },
  { key: 'season_silverware_gain', def: 40, label: 'Silverware: rating gain', group: 'Season (set after first fortnight)' },
  { key: 'season_silverware_full_pct', def: 60, label: 'Silverware: % full results', group: 'Season (set after first fortnight)' },

  { key: 'relegation_months', def: 2, label: 'Month-ends below band before relegation', group: 'Divisions' },
];

export const CONFIG_KEYS = new Set(CONFIG_SPEC.map((c) => c.key));
const DEFAULTS = Object.fromEntries(CONFIG_SPEC.map((c) => [c.key, c.def]));

function parseValue(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build a lookup `at(iso)` → full config object in effect at that instant.
 * `rows` are config-tab rows: { key, value, effective_from }.
 */
export function makeConfigAt(rows = []) {
  const history = rows
    .filter((r) => CONFIG_KEYS.has(r.key) && r.effective_from)
    .map((r) => ({ key: r.key, value: parseValue(r.value), at: r.effective_from }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  return function at(iso) {
    const cfg = { ...DEFAULTS };
    for (const h of history) {
      if (iso !== undefined && h.at > iso) break;
      cfg[h.key] = h.value;
    }
    return cfg;
  };
}

export function puzzleRatingFor(cfg, difficulty) {
  const d = Math.round(Number(difficulty));
  const v = cfg[`diff_rating_${d}`];
  return Number.isFinite(v) ? v : null;
}

export function validateConfigValue(key, value) {
  if (!CONFIG_KEYS.has(key)) return `Unknown setting: ${key}`;
  if (value === null || value === '' || value === undefined) return null; // clearing = "not set"
  const n = Number(value);
  if (!Number.isFinite(n)) return `${key} must be a number`;
  if (n < 0) return `${key} cannot be negative`;
  return null;
}
