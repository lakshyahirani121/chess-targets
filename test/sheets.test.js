// Exercises the Google Sheets adapter against a local fake of Google's token and
// Sheets v4 endpoints: auth, tab creation, headers, append, update, upsert, RAW writes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { SheetsStore } from '../lib/store/sheets.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });

const sheets = new Map(); // title → rows (array of arrays)
const log = [];
let server;
let base;

function a1ToIndex(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseRange(range) {
  const [title, cells = ''] = decodeURIComponent(range).split('!');
  let m = cells.match(/^(\d+):(\d+)$/);
  if (m) return { title, row: Number(m[1]), col: 0 };
  m = cells.match(/^([A-Z]+)(\d+)/);
  return { title, row: m ? Number(m[2]) : 1, col: m ? a1ToIndex(m[1]) : 0 };
}

before(async () => {
  server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    const url = new URL(req.url, 'http://x');
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    log.push(`${req.method} ${url.pathname}${url.search}`);

    if (url.pathname === '/token') {
      const assertion = new URLSearchParams(raw).get('assertion');
      const [h, c, s] = assertion.split('.');
      const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url'));
      const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
      if (!ok || claims.scope !== 'https://www.googleapis.com/auth/spreadsheets') return send(401, { error: 'invalid_grant' });
      return send(200, { access_token: 'tok', expires_in: 3600 });
    }
    if (req.headers.authorization !== 'Bearer tok') return send(401, { error: { message: 'no auth' } });
    const m = url.pathname.match(/^\/v4\/spreadsheets\/([^/:]+)(.*)$/);
    if (!m || m[1] !== 'SHEET') return send(404, { error: { message: 'Requested entity was not found.' } });
    const rest = m[2];
    const body = raw ? JSON.parse(raw) : {};

    if (rest === '' && req.method === 'GET') return send(200, { sheets: [...sheets.keys()].map((title) => ({ properties: { title } })) });
    if (rest === ':batchUpdate') {
      for (const r of body.requests) sheets.set(r.addSheet.properties.title, []);
      return send(200, {});
    }
    if (rest === '/values:batchGet') {
      const ranges = url.searchParams.getAll('ranges');
      return send(200, {
        valueRanges: ranges.map((r) => {
          const { title, row } = parseRange(r);
          const all = sheets.get(title) || [];
          const isHeader = /!1:1$/.test(decodeURIComponent(r));
          const values = isHeader ? all.slice(0, 1) : all.slice(row - 1);
          return { range: r, values };
        }),
      });
    }
    if (rest === '/values:batchUpdate') {
      assert.equal(body.valueInputOption, 'RAW');
      for (const d of body.data) {
        const { title, row, col } = parseRange(d.range);
        const rows = sheets.get(title);
        d.values.forEach((vals, i) => {
          const target = (rows[row - 1 + i] ||= []);
          vals.forEach((v, j) => { target[col + j] = v; });
        });
      }
      return send(200, {});
    }
    const ap = rest.match(/^\/values\/(.+):append$/);
    if (ap) {
      assert.equal(url.searchParams.get('valueInputOption'), 'RAW');
      const { title } = parseRange(ap[1]);
      sheets.get(title).push(...body.values);
      return send(200, {});
    }
    send(400, { error: { message: `unhandled ${rest}` } });
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('sheets adapter: creates tabs, writes RAW, reads back, updates, upserts', async () => {
  sheets.set('puzzles', [['id', 'difficulty']]); // pre-existing tab with partial headers
  const store = new SheetsStore({ sheetId: 'SHEET', serviceAccount: { email: 'sa@x.iam', key: pem, tokenUri: `${base}/token` }, baseUrl: base });

  let data = await store.load();
  assert.deepEqual(Object.keys(data).sort(), ['attempts', 'awards', 'config', 'handovers', 'puzzles']);
  assert.deepEqual(sheets.get('puzzles')[0].slice(0, 3), ['id', 'difficulty', 'set'], 'missing columns appended after existing ones');

  await store.upsert('puzzles', [{ id: '4.10', set: '4', number: '10', difficulty: '3', answer: '=HYPERLINK("x")' }]);
  await store.append('attempts', [{ id: 'a1', puzzle_id: '4.10', status: 'open', started_at: '2026-11-09T10:00:00.000Z' }]);
  await store.update('attempts', 'a1', { status: 'finished', hint_used: true, line: 'Nf3' });
  await store.upsert('puzzles', [{ id: '4.10', hint: 'updated' }, { id: '4.11', difficulty: '2' }]);

  data = await store.load();
  assert.equal(data.puzzles.length, 2);
  const p = data.puzzles.find((x) => x.id === '4.10');
  assert.equal(p.hint, 'updated');
  assert.equal(p.answer, '=HYPERLINK("x")', 'stored as plain text');
  assert.equal(p.difficulty, '3', 'upsert keeps untouched fields');
  assert.equal(data.attempts[0].status, 'finished');
  assert.equal(data.attempts[0].hint_used, 'TRUE');
  assert.equal(data.attempts[0].started_at, '2026-11-09T10:00:00.000Z');
  assert.equal(log.filter((l) => l.startsWith('POST /token')).length, 1, 'access token cached');
});

test('sheets adapter: clear error when the sheet is not shared / wrong id', async () => {
  const store = new SheetsStore({ sheetId: 'WRONG', serviceAccount: { email: 'sa@x.iam', key: pem, tokenUri: `${base}/token` }, baseUrl: base });
  await assert.rejects(store.load(), /shared \(Editor\) with the service account/);
});
