import { SCHEMA, TABLES, toCells } from './schema.js';

/** In-memory store. Used by tests, and as the base of the local file store. */
export class MemoryStore {
  constructor(initial = {}) {
    this.data = {};
    for (const t of TABLES) this.data[t] = (initial[t] || []).map((r) => toCells(t, r));
  }

  async load() {
    const out = {};
    for (const t of TABLES) out[t] = this.data[t].map((r) => ({ ...r }));
    return out;
  }

  async append(table, rows) {
    for (const r of rows) this.data[table].push(toCells(table, r));
    await this.persist();
  }

  async update(table, id, patch) {
    const row = this.data[table].find((r) => r.id === String(id));
    if (!row) throw Object.assign(new Error(`${table} row ${id} not found`), { status: 404 });
    for (const [k, v] of Object.entries(patch)) if (SCHEMA[table].includes(k)) row[k] = toCells(table, { [k]: v })[k];
    await this.persist();
  }

  async upsert(table, rows) {
    for (const r of rows) {
      const i = this.data[table].findIndex((x) => x.id === String(r.id));
      if (i >= 0) this.data[table][i] = toCells(table, { ...this.data[table][i], ...r });
      else this.data[table].push(toCells(table, r));
    }
    await this.persist();
  }

  async persist() {}
}
