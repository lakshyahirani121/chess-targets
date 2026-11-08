import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SheetsStore } from './sheets.js';
import { FileStore } from './file.js';
import { readServiceAccount } from '../google-auth.js';

let instance = null;

/** Google Sheets when configured; a local JSON file otherwise (never on Vercel). */
export function getStore(env = process.env) {
  if (instance) return instance;
  if (env.GOOGLE_SHEET_ID) {
    const sa = readServiceAccount(env);
    if (!sa) throw Object.assign(new Error('GOOGLE_SHEET_ID is set but the service account credentials are missing. Set GOOGLE_SERVICE_ACCOUNT_JSON.'), { status: 500 });
    instance = new SheetsStore({ sheetId: env.GOOGLE_SHEET_ID.trim(), serviceAccount: sa, baseUrl: env.GOOGLE_SHEETS_BASE });
  } else if (env.VERCEL) {
    throw Object.assign(new Error('Storage is not configured: set GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON in Vercel.'), { status: 500 });
  } else {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    instance = new FileStore(env.LOCAL_STORE_FILE || path.join(root, 'data', 'local-store.json'));
  }
  return instance;
}

export function setStore(store) {
  instance = store;
}
