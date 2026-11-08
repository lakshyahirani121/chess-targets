import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, parsePuzzleCsv } from '../lib/router.js';
import { MemoryStore } from '../lib/store/memory.js';

const env = {
  COACH1_NAME: 'Coach A', COACH1_PASSWORD: 'coach-a-pass',
  COACH2_NAME: 'Coach B', COACH2_PASSWORD: 'coach-b-pass',
  STUDENT_NAME: 'Sam', STUDENT_PASSWORD: 'student-pass',
  SESSION_SECRET: 'test-secret-0123456789abcdef',
};

function setup() {
  let clock = Date.parse('2026-11-09T10:00:00.000Z');
  const store = new MemoryStore({
    puzzles: [
      { id: '4.7', set: '4', number: '7', difficulty: '3', answer: 'Nxf7+ Kxf7 Qh5+', hint: 'Look at f7', clock_seconds: '120' },
      { id: '4.8', set: '4', number: '8', difficulty: '5', answer: 'Rxh7+ Kxh7 Qh5+', hint: '' },
    ],
  });
  const opts = { env, store, now: () => new Date(clock).toISOString() };
  const advance = (sec) => { clock += sec * 1000; };
  const cookies = {};
  async function call(who, method, path, body, query = {}) {
    const headers = { 'content-type': 'application/json' };
    if (who && cookies[who]) headers.cookie = cookies[who];
    const res = await handle({ method, path, query, body, headers }, opts);
    return { status: res.status, body: JSON.parse(res.body), headers: res.headers };
  }
  async function login(who, password) {
    const r = await call(null, 'POST', '/api/login', { password });
    assert.equal(r.status, 200);
    cookies[who] = r.headers['Set-Cookie'].split(';')[0];
    return r;
  }
  return { store, call, login, advance };
}

test('login picks the account by password; wrong password rejected', async () => {
  const { call, login } = setup();
  assert.equal((await login('s', 'student-pass')).body.role, 'student');
  assert.equal((await login('c', 'coach-a-pass')).body.role, 'coach');
  assert.equal((await call(null, 'POST', '/api/login', { password: 'nope' })).status, 401);
  assert.equal((await call(null, 'GET', '/api/state')).status, 401);
});

test('a forged cookie is rejected', async () => {
  const { call } = setup();
  const payload = Buffer.from(JSON.stringify({ u: 'coach1', exp: 9999999999 })).toString('base64url');
  const res = await handle({ method: 'GET', path: '/api/state', query: {}, headers: { cookie: `pl_session=${payload}.forged` } }, { env, store: new MemoryStore() });
  assert.equal(res.status, 401);
});

test('POST without JSON content type is refused (CSRF guard)', async () => {
  const res = await handle({ method: 'POST', path: '/api/login', query: {}, body: {}, headers: { 'content-type': 'application/x-www-form-urlencoded' } }, { env, store: new MemoryStore() });
  assert.equal(res.status, 415);
});

test('full attempt flow: server timer, auto-grade, answer reveal, coach confirm', async () => {
  const { call, login, advance } = setup();
  await login('s', 'student-pass');
  await login('c', 'coach-a-pass');

  // Before attempting: no answer for the student
  let list = (await call('s', 'GET', '/api/puzzles')).body.puzzles;
  assert.equal(list.find((p) => p.id === '4.7').answer, undefined);
  assert.equal(list.find((p) => p.id === '4.7').hint, undefined);

  const start = await call('s', 'POST', '/api/attempts/start', { puzzle_id: '4.7' });
  assert.equal(start.status, 200);
  advance(30);
  const again = await call('s', 'POST', '/api/attempts/start', { puzzle_id: '4.7' });
  assert.equal(again.body.resumed, true, 'pressing Start again resumes, clock not reset');
  assert.equal(again.body.attempt.started_at, start.body.attempt.started_at);
  advance(60);

  const fin = await call('s', 'POST', '/api/attempts/finish', { id: start.body.attempt.id, line: '1.Nxf7+ Kxf7 2.Qh5+', objective: 'win the queen', hint_used: false, self_called_wrong: false });
  assert.equal(fin.status, 200);
  assert.equal(fin.body.result.grade, 'full');
  assert.equal(fin.body.result.elapsed, 90);
  assert.ok(fin.body.result.bonuses.some((b) => b.label === 'Beat the clock'));
  assert.equal(fin.body.result.answer, 'Nxf7+ Kxf7 Qh5+');
  assert.equal(JSON.stringify(fin.body).includes('rating'), false);

  // Cannot submit twice
  assert.equal((await call('s', 'POST', '/api/attempts/finish', { id: start.body.attempt.id, line: 'x' })).status, 409);

  // Answer now visible to the student
  list = (await call('s', 'GET', '/api/puzzles')).body.puzzles;
  assert.equal(list.find((p) => p.id === '4.7').answer, 'Nxf7+ Kxf7 Qh5+');
  assert.equal(list.find((p) => p.id === '4.8').answer, undefined);

  // Coach queue has it; confirm
  let coach = (await call('c', 'GET', '/api/state')).body;
  assert.equal(coach.queue.length, 1);
  assert.ok(coach.rating > 1700);
  assert.equal((await call('c', 'POST', '/api/coach/grade', { id: start.body.attempt.id, grade: 'partial' })).status, 200);
  coach = (await call('c', 'GET', '/api/state')).body;
  assert.equal(coach.queue.length, 0);
  assert.equal(coach.history[0].grade, 'partial');
  assert.equal(coach.history[0].gradedBy, 'Coach A');
});

test('hint ticked caps the auto grade at partial', async () => {
  const { call, login } = setup();
  await login('s', 'student-pass');
  const st = await call('s', 'POST', '/api/attempts/start', { puzzle_id: '4.7' });
  const fin = await call('s', 'POST', '/api/attempts/finish', { id: st.body.attempt.id, line: 'Nxf7 Kxf7 Qh5', hint_used: true });
  assert.equal(fin.body.result.grade, 'partial');
});

test('student payload never contains the rating — in any form', async () => {
  const { call, login, advance } = setup();
  await login('s', 'student-pass');
  await login('c', 'coach-a-pass');
  const st = await call('s', 'POST', '/api/attempts/start', { puzzle_id: '4.8' });
  advance(40);
  await call('s', 'POST', '/api/attempts/finish', { id: st.body.attempt.id, line: 'Rxh7+ Kxh7 Qh5+', objective: 'mate' });

  const coach = (await call('c', 'GET', '/api/state')).body;
  const student = (await call('s', 'GET', '/api/state')).body;
  const studentAsCoachTries = (await call('s', 'GET', '/api/state', undefined, { as: 'coach' })).body;
  const preview = (await call('c', 'GET', '/api/state', undefined, { as: 'student' })).body;

  for (const payload of [student, studentAsCoachTries, preview]) {
    const text = JSON.stringify(payload);
    assert.equal(payload.role, 'student');
    assert.ok(!/rating|expected|delta|band"|puzzleRating|floor|fraction/i.test(text), `leak: ${text.match(/rating|expected|delta|band"|puzzleRating|floor|fraction/i)}`);
    const r = coach.rating;
    for (const v of [r.toFixed(0), r.toFixed(1), r.toFixed(2), String(r)]) assert.ok(!text.includes(v), `rating value ${v} leaked`);
  }
  assert.ok(typeof coach.rating === 'number');
});

test('coach-only routes are forbidden for the student', async () => {
  const { call, login } = setup();
  await login('s', 'student-pass');
  for (const [path, body] of [
    ['/api/coach/grade', { id: 'x', grade: 'full' }],
    ['/api/coach/config', { values: { daily_xp_cap: 999 } }],
    ['/api/coach/puzzles', { puzzles: [{ id: '1.1', difficulty: 1 }] }],
    ['/api/coach/awards', { xp: 50 }],
    ['/api/coach/handovers', { kind: 'bag', item: '1' }],
  ]) {
    assert.equal((await call('s', 'POST', path, body)).status, 403, path);
  }
});

test('coach cannot record attempts as the student', async () => {
  const { call, login } = setup();
  await login('c', 'coach-a-pass');
  assert.equal((await call('c', 'POST', '/api/attempts/start', { puzzle_id: '4.7' })).status, 403);
});

test('config edits are stored as history and validated', async () => {
  const { call, login, store, advance } = setup();
  await login('c', 'coach-a-pass');
  assert.equal((await call('c', 'POST', '/api/coach/config', { values: { bag_xp_milestone: 60 } })).body.changed, 1);
  advance(10);
  assert.equal((await call('c', 'POST', '/api/coach/config', { values: { bag_xp_milestone: 60 } })).body.changed, 0, 'unchanged value not re-recorded');
  assert.equal((await call('c', 'POST', '/api/coach/config', { values: { bag_xp_milestone: -1 } })).status, 400);
  assert.equal((await call('c', 'POST', '/api/coach/config', { values: { nonsense: 1 } })).status, 400);
  const data = await store.load();
  assert.equal(data.config.length, 1);
  const state = (await call('c', 'GET', '/api/state')).body;
  assert.equal(state.config.find((c) => c.key === 'bag_xp_milestone').value, 60);
});

test('CSV import validates and upserts puzzles', async () => {
  const { call, login, store } = setup();
  await login('c', 'coach-a-pass');
  const csv = 'id,difficulty,answer,hint,clock_seconds\n1.1,2,"Qh5 g6, Qxe5",Look at e5,\n1.10,4,Rxe8+ Qxe8,,90\n4.7,3,Nxf7+ Kxf7 Qh5+ Kg8,updated,\n';
  const r = await call('c', 'POST', '/api/coach/puzzles/import', { csv });
  assert.equal(r.status, 200);
  assert.equal(r.body.saved, 3);
  const data = await store.load();
  assert.equal(data.puzzles.find((p) => p.id === '1.10').number, '10', '"1.10" stays 1.10, not 1.1');
  assert.equal(data.puzzles.find((p) => p.id === '4.7').hint, 'updated');
  assert.equal(data.puzzles.length, 4);
  const bad = await call('c', 'POST', '/api/coach/puzzles/import', { csv: 'id,difficulty\n9,2\n1.2,7\n' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.errors.length, 2);
});

test('handovers: mark, refuse duplicate, undo', async () => {
  const { call, login } = setup();
  await login('c', 'coach-a-pass');
  assert.equal((await call('c', 'POST', '/api/coach/handovers', { kind: 'bag', item: '1' })).status, 200);
  assert.equal((await call('c', 'POST', '/api/coach/handovers', { kind: 'bag', item: '1' })).status, 409);
  const state = (await call('c', 'GET', '/api/state')).body;
  assert.equal(state.bags.released, 1, 'a handed-over bag is never taken back');
  assert.equal((await call('c', 'POST', '/api/coach/handovers/void', { id: state.rewards.handed[0].id })).status, 200);
  assert.equal((await call('c', 'GET', '/api/state')).body.bags.released, 0);
});

test('parsePuzzleCsv handles quotes and CRLF', () => {
  const { puzzles, errors } = parsePuzzleCsv('id,difficulty,answer\r\n2.3,1,"Nf3, ""quoted"""\r\n');
  assert.deepEqual(errors, []);
  assert.equal(puzzles[0].answer, 'Nf3, "quoted"');
});
