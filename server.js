// Local development server: serves public/ and the API on http://localhost:3000.
// Uses data/local-store.json unless GOOGLE_SHEET_ID is set in .env.local.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (no dependency).
for (const name of ['.env.local', '.env']) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const { nodeHandler } = await import('./lib/router.js');
const { authProblems } = await import('./lib/auth.js');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };
const pub = path.join(root, 'public');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return nodeHandler(req, res);
  let file = path.normalize(path.join(pub, decodeURIComponent(url.pathname)));
  if (!file.startsWith(pub)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(file).pipe(res);
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`Puzzle League running at http://localhost:${port}`);
  console.log(`Storage: ${process.env.GOOGLE_SHEET_ID ? 'Google Sheets' : 'data/local-store.json'}`);
  const problems = authProblems();
  if (problems.length) console.log(`\n⚠ Login not configured yet:\n  - ${problems.join('\n  - ')}\n  Copy .env.example to .env.local and fill it in.`);
});
