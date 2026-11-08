// Sheet tabs and their columns. Columns are matched by header name, so the order in
// the sheet does not matter and new columns are appended automatically.
export const SCHEMA = {
  puzzles: ['id', 'set', 'number', 'difficulty', 'answer', 'hint', 'clock_seconds', 'notes', 'updated_at'],
  attempts: [
    'id', 'puzzle_id', 'status', 'started_at', 'finished_at', 'line', 'objective',
    'hint_used', 'self_called_wrong', 'auto_grade', 'auto_reason', 'coach_grade',
    'graded_by', 'graded_at', 'puzzle_rating', 'clock_seconds',
  ],
  config: ['key', 'value', 'effective_from', 'changed_by'],
  awards: ['id', 'created_at', 'xp', 'note', 'by', 'voided_at'],
  handovers: ['id', 'kind', 'item', 'handed_over_at', 'by', 'voided_at'],
};

export const TABLES = Object.keys(SCHEMA);

/** Coerce every value to a string, like a sheet cell. */
export function toCells(table, row) {
  const out = {};
  for (const col of SCHEMA[table]) {
    const v = row[col];
    out[col] = v === undefined || v === null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
  }
  return out;
}
