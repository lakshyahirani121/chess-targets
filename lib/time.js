// UK calendar helpers. Every "day" and "month" in the league is a UK one
// (Europe/London, so BST is handled automatically).

const TZ = 'Europe/London';
const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function parts(iso) {
  const out = {};
  for (const p of partsFmt.formatToParts(new Date(iso))) out[p.type] = p.value;
  return out;
}

/** 'YYYY-MM-DD' in UK time. */
export function ukDate(iso) {
  const p = parts(iso);
  return `${p.year}-${p.month}-${p.day}`;
}

/** 'YYYY-MM' in UK time. */
export function ukMonth(iso) {
  const p = parts(iso);
  return `${p.year}-${p.month}`;
}

export function nextMonth(key) {
  let [y, m] = key.split('-').map(Number);
  m += 1;
  if (m > 12) { m = 1; y += 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function secondsBetween(a, b) {
  return (Date.parse(b) - Date.parse(a)) / 1000;
}
