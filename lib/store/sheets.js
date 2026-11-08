// Google Sheets store. Each table is a tab; row 1 holds column names.
// Writes use valueInputOption=RAW so "4.10" stays the text "4.10" and nothing
// a user types is ever evaluated as a formula.
import { SCHEMA, TABLES, toCells } from './schema.js';
import { getAccessToken } from '../google-auth.js';

const colLetter = (i) => {
  let s = '';
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
};

export class SheetsStore {
  constructor({ sheetId, serviceAccount, baseUrl }) {
    this.sheetId = sheetId;
    this.sa = serviceAccount;
    this.base = (baseUrl || 'https://sheets.googleapis.com').replace(/\/$/, '');
    this.headers = null; // table → [column names as in the sheet]
  }

  async api(method, path, body) {
    const token = await getAccessToken(this.sa);
    const res = await fetch(`${this.base}/v4/spreadsheets/${encodeURIComponent(this.sheetId)}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json.error?.message || res.statusText;
      const hint = res.status === 403 || res.status === 404
        ? ' — check GOOGLE_SHEET_ID and that the sheet is shared (Editor) with the service account email.'
        : '';
      throw new Error(`Google Sheets ${res.status}: ${msg}${hint}`);
    }
    return json;
  }

  /** Create missing tabs and header columns. Runs once per warm server instance. */
  async ensureSchema() {
    if (this.headers) return;
    const meta = await this.api('GET', '?fields=sheets.properties.title');
    const existing = new Set((meta.sheets || []).map((s) => s.properties.title));
    const missing = TABLES.filter((t) => !existing.has(t));
    if (missing.length) {
      await this.api('POST', ':batchUpdate', { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) });
    }
    const got = await this.api('GET', `/values:batchGet?${TABLES.map((t) => `ranges=${encodeURIComponent(`${t}!1:1`)}`).join('&')}`);
    const headers = {};
    const fixes = [];
    TABLES.forEach((t, i) => {
      const row = (got.valueRanges?.[i]?.values?.[0] || []).map((h) => String(h).trim());
      const add = SCHEMA[t].filter((c) => !row.includes(c));
      if (add.length) {
        const full = [...row, ...add];
        fixes.push({ range: `${t}!A1:${colLetter(full.length - 1)}1`, values: [full] });
        headers[t] = full;
      } else headers[t] = row;
    });
    if (fixes.length) await this.api('POST', '/values:batchUpdate', { valueInputOption: 'RAW', data: fixes });
    this.headers = headers;
  }

  rowToObj(table, row) {
    const obj = {};
    this.headers[table].forEach((h, i) => {
      if (h) obj[h] = row[i] === undefined || row[i] === null ? '' : String(row[i]);
    });
    return obj;
  }

  objToRow(table, obj) {
    const cells = toCells(table, obj);
    return this.headers[table].map((h) => (h in cells ? cells[h] : obj[h] ?? ''));
  }

  async readTables(tables) {
    await this.ensureSchema();
    const got = await this.api('GET', `/values:batchGet?${tables.map((t) => `ranges=${encodeURIComponent(`${t}!A2:ZZ`)}`).join('&')}`);
    const out = {};
    tables.forEach((t, i) => {
      const rows = got.valueRanges?.[i]?.values || [];
      out[t] = rows
        .map((r, idx) => ({ obj: this.rowToObj(t, r), at: idx + 2 }))
        .filter((x) => Object.values(x.obj).some((v) => v !== ''))
        .map((x) => ({ ...x.obj, __row: x.at }));
    });
    return out;
  }

  async load() {
    const data = await this.readTables(TABLES);
    for (const t of TABLES) data[t] = data[t].map(({ __row, ...r }) => r);
    return data;
  }

  async append(table, rows) {
    await this.ensureSchema();
    await this.api('POST', `/values/${encodeURIComponent(`${table}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      values: rows.map((r) => this.objToRow(table, r)),
    });
  }

  async update(table, id, patch) {
    const { [table]: rows } = await this.readTables([table]);
    const row = rows.find((r) => r.id === String(id));
    if (!row) throw Object.assign(new Error(`${table} row ${id} not found`), { status: 404 });
    const { __row, ...current } = row;
    const next = { ...current, ...patch };
    await this.api('POST', '/values:batchUpdate', {
      valueInputOption: 'RAW',
      data: [{ range: `${table}!A${__row}:${colLetter(this.headers[table].length - 1)}${__row}`, values: [this.objToRow(table, next)] }],
    });
  }

  async upsert(table, list) {
    const { [table]: rows } = await this.readTables([table]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const updates = [];
    const appends = [];
    for (const r of list) {
      const hit = byId.get(String(r.id));
      if (hit) {
        const { __row, ...current } = hit;
        updates.push({ range: `${table}!A${__row}:${colLetter(this.headers[table].length - 1)}${__row}`, values: [this.objToRow(table, { ...current, ...r })] });
      } else appends.push(r);
    }
    if (updates.length) await this.api('POST', '/values:batchUpdate', { valueInputOption: 'RAW', data: updates });
    if (appends.length) await this.append(table, appends);
  }
}
