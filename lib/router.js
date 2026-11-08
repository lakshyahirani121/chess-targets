// All API routes. Framework-free: handle({ method, path, query, body, headers }) → { status, headers, body }.
import crypto from 'node:crypto';
import { getStore } from './store/index.js';
import { authProblems, matchPassword, makeSessionCookie, clearSessionCookie, sessionAccount } from './auth.js';
import { buildView, puzzleList } from './views.js';
import { runLeague } from './engine.js';
import { autoGrade } from './grading.js';
import { makeConfigAt, puzzleRatingFor, validateConfigValue, CONFIG_KEYS } from './config.js';
import { notifyAttempt } from './notify.js';

const GRADES = new Set(['full', 'partial', 'wrong']);
const newId = () => crypto.randomBytes(8).toString('hex');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (status, body, headers = {}) => ({ status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, body: JSON.stringify(body) });

function str(v, max, field) {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters)`);
  return s;
}

function validPuzzleId(id) {
  return /^\d{1,3}\.\d{1,3}$/.test(String(id || '').trim());
}

/** Parse "4.7" style puzzle rows from CSV text (header row required). */
export function parsePuzzleCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  const src = String(text || '').replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!nonEmpty.length) return { puzzles: [], errors: ['The CSV is empty.'] };
  const header = nonEmpty[0].map((h) => h.trim().toLowerCase());
  if (!header.includes('id')) return { puzzles: [], errors: ['The first row must be a header containing at least: id,difficulty,answer'] };
  const puzzles = [];
  const errors = [];
  nonEmpty.slice(1).forEach((r, i) => {
    const obj = {};
    header.forEach((h, j) => { obj[h] = (r[j] ?? '').trim(); });
    try {
      puzzles.push(cleanPuzzle(obj));
    } catch (e) {
      errors.push(`Row ${i + 2}: ${e.message}`);
    }
  });
  return { puzzles, errors };
}

function cleanPuzzle(p) {
  const id = String(p.id || '').trim();
  if (!validPuzzleId(id)) throw new HttpError(400, `"${id}" is not a puzzle id like 4.7`);
  const [set, number] = id.split('.');
  const difficulty = Number(p.difficulty);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw new HttpError(400, `${id}: difficulty must be 1–5`);
  let clock = String(p.clock_seconds ?? '').trim();
  if (clock !== '') {
    const n = Number(clock);
    if (!Number.isFinite(n) || n <= 0 || n > 36000) throw new HttpError(400, `${id}: clock_seconds must be a positive number of seconds`);
    clock = String(Math.round(n));
  }
  return {
    id,
    set,
    number,
    difficulty: String(difficulty),
    answer: str(p.answer, 1000, 'answer'),
    hint: str(p.hint, 1000, 'hint'),
    clock_seconds: clock,
    notes: str(p.notes, 2000, 'notes'),
    updated_at: new Date().toISOString(),
  };
}

export async function handle(req, { env = process.env, store: storeOverride, now: nowOverride } = {}) {
  try {
    return await route(req, env, storeOverride, nowOverride);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    return json(status, { error: status >= 500 && !err.status ? 'Something went wrong on the server.' : err.message });
  }
}

async function route(req, env, storeOverride, nowOverride) {
  const method = req.method || 'GET';
  const path = '/' + String(req.path || '').replace(/^\/+|\/+$/g, '').replace(/^api\/?/, '');
  const now = () => (nowOverride ? nowOverride() : new Date().toISOString());
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') || !!env.VERCEL;

  if (method !== 'GET' && !/application\/json/i.test(req.headers['content-type'] || '')) {
    throw new HttpError(415, 'Requests must be JSON.');
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  // ---- public routes -------------------------------------------------------
  if (path === '/health' && method === 'GET') {
    const problems = authProblems(env);
    return json(200, { ok: problems.length === 0, problems, storage: env.GOOGLE_SHEET_ID ? 'google-sheets' : env.VERCEL ? 'not configured' : 'local file' });
  }

  if (path === '/login' && method === 'POST') {
    const problems = authProblems(env);
    if (problems.length) throw new HttpError(500, `Login is not configured: ${problems.join('; ')}`);
    const acct = matchPassword(String(body.password || ''), env);
    if (!acct) {
      await new Promise((r) => setTimeout(r, 400));
      throw new HttpError(401, 'Wrong password.');
    }
    return json(200, { ok: true, role: acct.role, name: acct.name }, { 'Set-Cookie': makeSessionCookie(acct, { secure, env }) });
  }

  if (path === '/logout' && method === 'POST') {
    return json(200, { ok: true }, { 'Set-Cookie': clearSessionCookie({ secure }) });
  }

  const viewer = sessionAccount(req.headers.cookie || '', env);
  if (path === '/me' && method === 'GET') {
    return json(200, { user: viewer });
  }
  if (!viewer) throw new HttpError(401, 'Please log in.');
  const isCoach = viewer.role === 'coach';
  const requireCoach = () => {
    if (!isCoach) throw new HttpError(403, 'Coaches only.');
  };

  const store = storeOverride || getStore(env);

  // ---- read ------------------------------------------------------------------
  if (path === '/state' && method === 'GET') {
    const data = await store.load();
    const as = isCoach ? req.query.as : undefined;
    return json(200, buildView(data, viewer, { now: now(), as }));
  }

  if (path === '/puzzles' && method === 'GET') {
    const data = await store.load();
    const as = isCoach ? req.query.as : undefined;
    return json(200, { puzzles: puzzleList(data, viewer, { as }) });
  }

  // ---- student attempt flow ----------------------------------------------------
  if (path === '/attempts/start' && method === 'POST') {
    if (viewer.role !== 'student') throw new HttpError(403, 'Only the student account records attempts.');
    const pid = String(body.puzzle_id || '').trim();
    const data = await store.load();
    const puzzle = data.puzzles.find((p) => p.id === pid);
    if (!puzzle) throw new HttpError(404, `Puzzle ${pid} is not in the system yet.`);
    const existing = data.attempts.find((a) => a.status === 'open' && a.puzzle_id === pid);
    if (existing) {
      return json(200, { attempt: { id: existing.id, puzzle_id: pid, started_at: existing.started_at, clock: Number(existing.clock_seconds) || null }, resumed: true, serverNow: now() });
    }
    const attempt = {
      id: newId(),
      puzzle_id: pid,
      status: 'open',
      started_at: now(),
      clock_seconds: puzzle.clock_seconds || '',
    };
    await store.append('attempts', [attempt]);
    return json(200, { attempt: { id: attempt.id, puzzle_id: pid, started_at: attempt.started_at, clock: Number(attempt.clock_seconds) || null }, resumed: false, serverNow: now() });
  }

  if (path === '/attempts/finish' && method === 'POST') {
    if (viewer.role !== 'student') throw new HttpError(403, 'Only the student account records attempts.');
    const line = str(body.line, 500, 'Line');
    const objective = str(body.objective, 300, 'What you were playing for');
    if (!line) throw new HttpError(400, 'Write your line before finishing.');
    const data = await store.load();
    const attempt = data.attempts.find((a) => a.id === String(body.id || ''));
    if (!attempt) throw new HttpError(404, 'Attempt not found.');
    if (attempt.status !== 'open') throw new HttpError(409, 'This attempt was already submitted.');
    const puzzle = data.puzzles.find((p) => p.id === attempt.puzzle_id);
    const finishedAt = now();
    const hint = body.hint_used === true;
    const selfCall = body.self_called_wrong === true;
    const check = autoGrade(line, puzzle?.answer);
    const grade = hint && check.grade === 'full' ? 'partial' : check.grade;
    const cfg = makeConfigAt(data.config)(finishedAt);
    const patch = {
      status: 'finished',
      finished_at: finishedAt,
      line,
      objective,
      hint_used: hint,
      self_called_wrong: selfCall,
      auto_grade: grade,
      auto_reason: hint && check.grade === 'full' ? `${check.reason} Capped at partial: hint used.` : check.reason,
      puzzle_rating: puzzleRatingFor(cfg, puzzle?.difficulty) ?? '',
    };
    await store.update('attempts', attempt.id, patch);
    const after = { ...attempt, ...patch, hint_used: hint ? 'TRUE' : 'FALSE', self_called_wrong: selfCall ? 'TRUE' : 'FALSE', puzzle_rating: String(patch.puzzle_rating) };
    const nextData = { ...data, attempts: data.attempts.map((a) => (a.id === attempt.id ? after : a)) };
    const league = runLeague(nextData, { now: finishedAt });
    const r = league.resultById.get(attempt.id);
    await notifyAttempt({ attempt: after, puzzle, studentName: viewer.name }, env);
    return json(200, {
      result: {
        id: attempt.id,
        puzzle_id: attempt.puzzle_id,
        grade: r.grade,
        provisional: true,
        reason: patch.auto_reason,
        reattempt: r.reattempt,
        xp: r.xp,
        bonuses: r.bonuses.map((b) => ({ label: b.label, xp: b.xp })),
        capped: r.capped || 0,
        elapsed: r.elapsed !== null ? Math.round(r.elapsed) : null,
        clock: r.clock,
        answer: puzzle?.answer || '',
      },
    });
  }

  // ---- coach ---------------------------------------------------------------------
  if (path === '/coach/grade' && method === 'POST') {
    requireCoach();
    const grade = String(body.grade || '');
    if (!GRADES.has(grade)) throw new HttpError(400, 'Grade must be full, partial or wrong.');
    const data = await store.load();
    const attempt = data.attempts.find((a) => a.id === String(body.id || ''));
    if (!attempt || attempt.status !== 'finished') throw new HttpError(404, 'Attempt not found.');
    await store.update('attempts', attempt.id, { coach_grade: grade, graded_by: viewer.name, graded_at: now() });
    return json(200, { ok: true });
  }

  if (path === '/coach/puzzles' && method === 'POST') {
    requireCoach();
    const list = Array.isArray(body.puzzles) ? body.puzzles : [];
    if (!list.length) throw new HttpError(400, 'No puzzles sent.');
    if (list.length > 1000) throw new HttpError(400, 'Too many puzzles in one request (max 1000).');
    const clean = list.map(cleanPuzzle);
    await store.upsert('puzzles', clean);
    return json(200, { ok: true, saved: clean.length });
  }

  if (path === '/coach/puzzles/import' && method === 'POST') {
    requireCoach();
    const { puzzles, errors } = parsePuzzleCsv(body.csv);
    if (errors.length) return json(400, { error: `Fix these rows and import again:\n${errors.slice(0, 20).join('\n')}`, errors });
    if (!puzzles.length) throw new HttpError(400, 'No puzzle rows found.');
    const ids = new Set();
    for (const p of puzzles) {
      if (ids.has(p.id)) throw new HttpError(400, `Puzzle ${p.id} appears twice in the CSV.`);
      ids.add(p.id);
    }
    await store.upsert('puzzles', puzzles);
    return json(200, { ok: true, saved: puzzles.length });
  }

  if (path === '/coach/config' && method === 'POST') {
    requireCoach();
    const values = body.values && typeof body.values === 'object' ? body.values : {};
    const data = await store.load();
    const current = makeConfigAt(data.config)(now());
    const rows = [];
    for (const [key, raw] of Object.entries(values)) {
      if (!CONFIG_KEYS.has(key)) throw new HttpError(400, `Unknown setting: ${key}`);
      const problem = validateConfigValue(key, raw);
      if (problem) throw new HttpError(400, problem);
      const value = raw === null || raw === undefined || String(raw).trim() === '' ? '' : String(Number(raw));
      const cur = current[key] === null || current[key] === undefined ? '' : String(current[key]);
      if (value !== cur) rows.push({ key, value, effective_from: now(), changed_by: viewer.name });
    }
    if (rows.length) await store.append('config', rows);
    return json(200, { ok: true, changed: rows.length });
  }

  if (path === '/coach/awards' && method === 'POST') {
    requireCoach();
    const xp = Number(body.xp);
    if (!Number.isInteger(xp) || xp <= 0 || xp > 500) throw new HttpError(400, 'XP must be a whole number between 1 and 500.');
    const note = str(body.note, 200, 'Note');
    await store.append('awards', [{ id: newId(), created_at: now(), xp: String(xp), note, by: viewer.name }]);
    return json(200, { ok: true });
  }

  if (path === '/coach/awards/void' && method === 'POST') {
    requireCoach();
    await store.update('awards', String(body.id || ''), { voided_at: now() });
    return json(200, { ok: true });
  }

  if (path === '/coach/handovers' && method === 'POST') {
    requireCoach();
    const kind = String(body.kind || '');
    const item = String(body.item || '').trim();
    if (!['badge', 'bag'].includes(kind) || !item) throw new HttpError(400, 'kind must be badge or bag, with an item.');
    const data = await store.load();
    if (data.handovers.some((h) => !h.voided_at && h.kind === kind && h.item === item)) throw new HttpError(409, 'Already marked as handed over.');
    await store.append('handovers', [{ id: newId(), kind, item, handed_over_at: now(), by: viewer.name }]);
    return json(200, { ok: true });
  }

  if (path === '/coach/handovers/void' && method === 'POST') {
    requireCoach();
    await store.update('handovers', String(body.id || ''), { voided_at: now() });
    return json(200, { ok: true });
  }

  throw new HttpError(404, 'Not found.');
}

/** Adapter for Node's (req, res): used by Vercel and the local dev server. */
export async function nodeHandler(req, res, options = {}) {
  const url = new URL(req.url, 'http://localhost');
  const query = Object.fromEntries(url.searchParams);
  let path = query.route !== undefined ? query.route : url.pathname;
  delete query.route;
  let body;
  try {
    body = req.body; // Vercel parses JSON lazily and throws on malformed input
  } catch {
    body = {};
  }
  if (body === undefined && req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 2_000_000) {
        res.statusCode = 413;
        return res.end('{"error":"Request too large."}');
      }
      chunks.push(c);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
  } else if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  const out = await handle({ method: req.method, path, query, body, headers: req.headers }, options);
  res.statusCode = out.status;
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.end(out.body);
}
