// Division ladder. Index 0 is the bottom (Division 5), 6 the top (Hall of fame).

export const DIVISIONS = [
  { key: 'D5', name: 'Division 5', numeral: '5', floor: -Infinity, band: 'below 1600' },
  { key: 'D4', name: 'Division 4', numeral: '4', floor: 1600, band: '1600–1699' },
  { key: 'D3', name: 'Division 3', numeral: '3', floor: 1700, band: '1700–1799' },
  { key: 'D2', name: 'Division 2', numeral: '2', floor: 1800, band: '1800–1899' },
  { key: 'D1', name: 'Division 1', numeral: '1', floor: 1900, band: '1900–1999' },
  { key: 'P', name: 'Premier', numeral: 'P', floor: 2000, band: '2000–2149' },
  { key: 'H', name: 'Hall of fame', numeral: 'H', floor: 2150, band: '2150+' },
];

export const TOP = DIVISIONS.length - 1;

/** Index of the band a rating sits in. */
export function bandIndex(rating) {
  let idx = 0;
  for (let i = 1; i < DIVISIONS.length; i++) if (rating >= DIVISIONS[i].floor) idx = i;
  return idx;
}

// Division 5 has no floor; for the progress bar only, treat it as 100 points wide.
function displayFloor(i) {
  return i === 0 ? DIVISIONS[1].floor - 100 : DIVISIONS[i].floor;
}

/** Exact progress through the current division toward the next (coach only). 0..1 */
export function progressFraction(rating, divisionIndex) {
  if (divisionIndex >= TOP) return 1;
  const lo = displayFloor(divisionIndex);
  const hi = DIVISIONS[divisionIndex + 1].floor;
  return Math.min(1, Math.max(0, (rating - lo) / (hi - lo)));
}

export const STEPS = ['Just started', 'Halfway there', 'Getting close', 'Almost there'];

/** Coarse word step for the student. Deliberately only four values. */
export function progressStep(rating, divisionIndex) {
  if (divisionIndex >= TOP) return { index: 4, label: 'Top division' };
  const f = progressFraction(rating, divisionIndex);
  const index = f < 0.4 ? 0 : f < 0.7 ? 1 : f < 0.9 ? 2 : 3;
  return { index, label: STEPS[index] };
}

/** Width (%) the student's stepped bar shows for each step. */
export const STEP_WIDTH = [15, 45, 70, 90, 100];
