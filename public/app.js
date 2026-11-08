// Puzzle League — single-page client. Renders whatever /api/state returns for the
// logged-in role. The student's payload never contains the rating, so nothing here
// can show it to him.
import { playSession } from './anim.js';

const STEP_WIDTH = [15, 45, 70, 90, 100];
const STEP_TICKS = [40, 70, 90];
const app = document.getElementById('app');
const S = {
  me: null,
  view: 'coach',
  data: null,
  puzzles: [],
  setSel: null,
  pick: null,
  browse: false,
  result: null,
  skew: 0,
  playing: false,
  open: new Set(),
  puzzleFilter: '',
  historyLimit: 25,
  editPuzzle: null,
};

// ---------------------------------------------------------------- utilities
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const ukDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' });
const ukTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
const fmtDay = (iso) => (iso ? (iso.length === 10 ? ukDay.format(new Date(`${iso}T12:00:00Z`)) : ukDay.format(new Date(iso))) : '');
const fmtWhen = (iso) => (iso ? `${ukDay.format(new Date(iso))} ${ukTime.format(new Date(iso))}` : '');
const fmtClock = (sec) => {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtDelta = (d) => (d === null || d === undefined ? '—' : `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`);
const GRADE_LABEL = { full: 'Full', partial: 'Partial', wrong: 'Wrong' };

function stars(n) {
  let out = '<span class="stars" aria-label="' + n + ' of 5 stars">';
  for (let i = 1; i <= 5; i++) out += `<span class="star${i <= n ? '' : ' off'}">${i <= n ? '★' : '☆'}</span>`;
  return out + '</span>';
}
function stamp(grade, { provisional = false, sm = false } = {}) {
  return `<span class="stamp ${esc(grade)}${provisional ? ' provisional' : ''}${sm ? ' sm' : ''}">${esc(GRADE_LABEL[grade] || grade)}</span>`;
}
function bar(pct, { effort = false, ticks = [], id = '' } = {}) {
  return `<div class="bar${effort ? ' effort' : ''}"${id ? ` id="${id}"` : ''}>${ticks.map((t) => `<span class="tick" style="left:${t}%"></span>`).join('')}<div class="fill" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
}

async function api(path, body) {
  const opts = body === undefined
    ? { credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(`/api/${path}`, opts);
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && path !== 'login') {
    S.me = null;
    renderLogin();
    throw new Error(data.error || 'Please log in.');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer = null;
function toast(msg, err = false) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.className = `toast${err ? ' err' : ''}`;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), err ? 6000 : 2600);
}

// ---------------------------------------------------------------- theme
const THEMES = ['auto', 'light', 'dark'];
function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'auto'; }
function cycleTheme() {
  const next = THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length];
  if (next === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', next);
  store.set('pl-theme', next === 'auto' ? null : next);
}

// ---------------------------------------------------------------- data
const asStudent = () => S.me?.role === 'coach' && S.view === 'student';

async function load({ puzzles = true } = {}) {
  const q = asStudent() ? '?as=student' : '';
  const [data, pz] = await Promise.all([api(`state${q}`), puzzles ? api(`puzzles${q}`) : Promise.resolve(null)]);
  S.data = data;
  if (pz) S.puzzles = pz.puzzles;
  S.skew = Date.parse(data.serverNow) - Date.now();
  render();
}

// ---------------------------------------------------------------- login
function renderLogin(error = '') {
  app.innerHTML = `
    <form class="login" id="login-form" autocomplete="on">
      <h1 class="display">Puzzle League</h1>
      <p>Private. One student, two coaches.</p>
      <label class="field">Password
        <input type="password" name="password" autocomplete="current-password" required autofocus>
      </label>
      <button class="btn primary big" type="submit">Log in</button>
      ${error ? `<div class="notice err">${esc(error)}</div>` : ''}
    </form>`;
  document.querySelector('#login-form input')?.focus();
}

// ---------------------------------------------------------------- header + hero
function header(d) {
  const coachUser = S.me.role === 'coach';
  return `
  <header class="site-header">
    <span class="who">${esc(d.studentName)}</span>
    <span class="chip">${esc(d.season.label)} season</span>
    <span class="badge sm earned" title="${esc(d.division.name)}">${esc(d.division.numeral)}</span>
    <span class="chip skill">${esc(d.division.name)}</span>
    <span class="spacer"></span>
    ${coachUser ? `<div class="seg" role="group" aria-label="View">
      <button type="button" data-action="view" data-view="coach" aria-pressed="${S.view === 'coach'}">Coach</button>
      <button type="button" data-action="view" data-view="student" aria-pressed="${S.view === 'student'}">Student view</button>
    </div>` : ''}
    ${d.role === 'coach' ? `<span class="num skill hdr-rating" title="Puzzle rating">${Math.round(d.rating)}</span>` : ''}
    <button class="btn sm" type="button" data-action="theme" title="Theme">${esc(currentTheme())}</button>
    <button class="btn sm" type="button" data-action="logout">Log out</button>
  </header>`;
}

function sessionCard(r) {
  if (!r) return '<div class="pcard dim small">No sessions yet.</div>';
  const c = r.card;
  return `<div class="pcard" id="session-card">
      <span class="pid">Set ${esc(c.set)} · ${esc(c.puzzle_id)}</span>
      ${stars(c.difficulty)}
      ${stamp(c.grade, { provisional: c.provisional })}
    </div>`;
}

function cleanSheetText(t) {
  const cs = t.cleanSheet;
  if (!cs.attempts) return '—';
  if (!cs.onTrack) return 'Not today';
  if (cs.attempts < cs.needed) return `${cs.attempts}/${cs.needed}`;
  return 'On track';
}

function hero(d) {
  const left = d.role === 'coach'
    ? `<div class="hero-label">Puzzle rating</div>
       <div class="hero-num skill" id="rating-count">${Math.round(d.rating)}</div>
       <div class="stats">
         <div class="stat"><div class="k">Last Δ</div><div class="v ${d.lastResult && d.lastResult.delta >= 0 ? 'pos' : 'neg'}">${d.lastResult ? fmtDelta(d.lastResult.delta) : '—'}</div></div>
         <div class="stat"><div class="k">Expected</div><div class="v">${d.lastResult ? d.lastResult.expected.toFixed(2) : '—'}</div></div>
         <div class="stat"><div class="k">K</div><div class="v">${d.lastResult ? d.lastResult.k : '—'}</div></div>
         <div class="stat"><div class="k">Graded</div><div class="v">${d.gradedCount}</div></div>
         <div class="stat"><div class="k">Season XP</div><div class="v effort" id="xp-count">${d.xp}</div></div>
         <div class="stat"><div class="k">This month</div><div class="v">${d.season.puzzles}</div></div>
       </div>`
    : `<div class="hero-label">Season XP</div>
       <div class="hero-num effort" id="xp-count">${d.xp}</div>
       <div class="stats">
         <div class="stat"><div class="k">Puzzles this month</div><div class="v">${d.season.puzzles}</div></div>
         <div class="stat"><div class="k">Today</div><div class="v">${d.today.xp}<span class="faint">/${d.today.cap ?? '∞'}</span></div></div>
         <div class="stat"><div class="k">Clean sheet</div><div class="v">${cleanSheetText(d.today)}</div></div>
       </div>`;
  return `
  <section class="hero" aria-label="Summary">
    <div>${left}</div>
    <div class="session-side">
      <div class="hero-label">Last session${d.replay ? ` · ${esc(fmtDay(d.replay.date))}` : ''}</div>
      ${sessionCard(d.replay)}
      <button class="btn" type="button" data-action="play" ${d.replay ? '' : 'disabled'}>▶ Play session</button>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- attempt (student)
function puzzleById(id) { return S.puzzles.find((p) => p.id === id); }
const setsOf = () => [...new Set(S.puzzles.map((p) => p.set))].sort((a, b) => Number(a) - Number(b));

function attemptSection(d) {
  const head = '<div class="section-head"><h2>Puzzle</h2><span class="aside">Solve on the board, then record it here.</span></div>';
  if (S.me.role !== 'student') {
    return `<section>${head}<div class="notice">Preview of the student's screen. Only the student account records attempts.</div></section>`;
  }
  if (S.result) return `<section id="attempt">${head}${resultView(S.result)}</section>`;
  const open = d.openAttempts.slice().sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  const active = open.find((o) => o.puzzle_id === S.pick) || (S.pick || S.browse ? null : open[0]);
  if (active) return `<section id="attempt">${head}${openView(active, open)}</section>`;
  return `<section id="attempt">${head}${pickerView(open)}</section>`;
}

function pickerView(open) {
  if (!S.puzzles.length) return '<div class="notice warn">No puzzles loaded yet. Ask your coach to add them.</div>';
  const sets = setsOf();
  if (!S.setSel || !sets.includes(S.setSel)) {
    const next = S.puzzles.find((p) => !p.attempted);
    S.setSel = next ? next.set : sets[0];
  }
  const inSet = S.puzzles.filter((p) => p.set === S.setSel);
  const sel = S.pick ? puzzleById(S.pick) : null;
  return `<div class="attempt">
    ${open.length ? `<div class="notice warn">Unfinished: ${open.map((o) => `<button class="btn sm" type="button" data-action="pick" data-pid="${esc(o.puzzle_id)}">${esc(o.puzzle_id)}</button>`).join(' ')} — the clock is still running.</div>` : ''}
    <div class="picker">
      <label class="field">Set
        <select id="set-select">${sets.map((s) => `<option value="${esc(s)}"${s === S.setSel ? ' selected' : ''}>Set ${esc(s)}</option>`).join('')}</select>
      </label>
      <form id="jump-form" class="picker">
        <label class="field">Go to
          <input type="text" name="pid" inputmode="decimal" placeholder="4.7" size="6" autocomplete="off">
        </label>
        <button class="btn" type="submit">Go</button>
      </form>
      <button class="btn" type="button" data-action="next-unsolved">Next unsolved</button>
    </div>
    <div class="pgrid" role="group" aria-label="Puzzles in set ${esc(S.setSel)}">
      ${inSet.map((p) => `<button type="button" data-action="pick" data-pid="${esc(p.id)}" class="${p.attempted ? 'done' : ''}" aria-pressed="${S.pick === p.id}" title="${p.attempted ? 'Already attempted' : 'Not attempted'}">${esc(p.id)}${p.attempted ? ' ✓' : ''}</button>`).join('')}
    </div>
    ${sel ? `<div class="pcard">
        <span class="pid">Set ${esc(sel.set)} · ${esc(sel.id)}</span>
        ${stars(sel.difficulty)}
        ${sel.clock_seconds ? `<span class="chip">Beat ${fmtClock(sel.clock_seconds)} for bonus XP</span>` : ''}
        ${sel.attempted ? '<span class="chip">Re-attempt · no points</span>' : ''}
        <span class="spacer" style="flex:1"></span>
        <button class="btn primary big" type="button" data-action="start" data-pid="${esc(sel.id)}">Start</button>
      </div>` : '<p class="dim small">Pick a puzzle number to begin.</p>'}
  </div>`;
}

function openView(o, open) {
  const p = puzzleById(o.puzzle_id) || { set: o.puzzle_id.split('.')[0], difficulty: 0 };
  const draft = JSON.parse(store.get(`pl-draft-${o.id}`) || '{}');
  const others = open.filter((x) => x.id !== o.id);
  return `<div class="attempt">
    <div class="pcard">
      <span class="pid">Set ${esc(p.set)} · ${esc(o.puzzle_id)}</span>
      ${stars(p.difficulty)}
      ${p.attempted ? '<span class="chip">Re-attempt · no points</span>' : ''}
    </div>
    <div class="bar-row">
      <div><div class="hero-label">Clock</div><div class="timer" id="timer" data-start="${esc(o.started_at)}" data-clock="${o.clock || ''}">0:00</div></div>
      ${o.clock ? `<div class="dim small">Beat <span class="num">${fmtClock(o.clock)}</span> with a full answer for bonus XP</div>` : ''}
    </div>
    <form id="finish-form" class="form-grid" data-id="${esc(o.id)}" autocomplete="off">
      <label class="field">Your line — both sides' moves
        <input class="line-input" type="text" name="line" required maxlength="500" placeholder="1.Nxf7+ Kxf7 2.Qh5+ Kg8 3.Qd5#" value="${esc(draft.line || '')}" spellcheck="false" autocapitalize="off">
      </label>
      <label class="field">What are you playing for?
        <input type="text" name="objective" maxlength="300" placeholder="mate · win the queen · fork on e6 …" value="${esc(draft.objective || '')}">
      </label>
      <label class="check"><input type="checkbox" name="hint_used"${draft.hint_used ? ' checked' : ''}> I used the hint</label>
      <label class="check"><input type="checkbox" name="self_called_wrong"${draft.self_called_wrong ? ' checked' : ''}> I think this is wrong</label>
      <div><button class="btn primary big" type="submit">Finish</button></div>
    </form>
    ${others.length ? `<div class="small dim">Also unfinished: ${others.map((x) => `<button class="btn sm" type="button" data-action="pick" data-pid="${esc(x.puzzle_id)}">${esc(x.puzzle_id)}</button>`).join(' ')}</div>` : ''}
    <div><button class="btn sm" type="button" data-action="browse">Back to puzzle list</button></div>
  </div>`;
}

function resultView(r) {
  const p = puzzleById(r.puzzle_id) || { set: r.puzzle_id.split('.')[0], difficulty: 0 };
  return `<div class="result">
    <div class="result-top">
      <div class="pcard"><span class="pid">Set ${esc(p.set)} · ${esc(r.puzzle_id)}</span>${stars(p.difficulty)}</div>
      ${stamp(r.grade, { provisional: true })}
      <span class="prov-note">Provisional · coach to confirm</span>
    </div>
    <div class="result-top">
      ${r.reattempt ? '<span class="chip">Re-attempt · no points</span>' : `<span class="xp-gain">+${r.xp} XP</span>`}
      <div class="bonus-list">${r.bonuses.map((b) => `<span class="chip effort">${esc(b.label)} +${b.xp}</span>`).join('')}</div>
      ${r.capped ? `<span class="small dim">${r.capped} XP over today's cap</span>` : ''}
    </div>
    <div class="small dim">${esc(r.reason)} · Time <span class="num">${fmtClock(r.elapsed)}</span>${r.clock ? ` (target ${fmtClock(r.clock)})` : ''}</div>
    <div class="answer-box"><div class="hero-label">Book answer</div><div class="mono">${esc(r.answer || 'Not in the system yet.')}</div></div>
    <div><button class="btn primary" type="button" data-action="next">Next puzzle</button></div>
  </div>`;
}

// ---------------------------------------------------------------- division ladder
function divisionSection(d) {
  const coach = d.role === 'coach';
  const pct = coach ? d.divisionDetail.fraction * 100 : d.division.step.width;
  const right = coach
    ? (d.divisionDetail.pointsToNext !== null ? `<span class="num">${Math.ceil(d.divisionDetail.pointsToNext)}</span> <span class="dim small">to next</span>` : '<span class="dim small">Top division</span>')
    : `<span class="big skill">${esc(d.division.step.label)}</span>`;
  const currentPos = d.ladder.findIndex((r) => r.state === 'current');
  return `<section>
    <div class="section-head"><h2>Division</h2>
      <span class="aside">${coach ? `Bands · promotion immediate · relegation after ${d.divisionDetail.relegationMonths} month-ends below` : 'Promotion is immediate. One bad month never relegates you.'}</span></div>
    <div class="bar-row"><span class="big">${esc(d.division.name)}</span><span>${right}</span></div>
    ${bar(pct, { id: 'div-bar', ticks: STEP_TICKS })}
    ${coach && d.divisionDetail.belowBand ? `<div class="notice warn" style="margin-top:12px">Below the band floor. Month-ends counted so far: <span class="num">${d.divisionDetail.monthsBelow}</span> of ${d.divisionDetail.relegationMonths}.</div>` : ''}
    <div class="ladder" id="ladder">
      <div class="ladder-marker" id="ladder-marker" style="top:${currentPos * 45}px"></div>
      ${d.ladder.map((r) => `<div class="lrow ${r.state}" data-div-index="${r.index}">
          <span class="ln">${esc(r.numeral)}</span>
          <span class="lname">${esc(r.name)}</span>
          <span class="lband">${coach ? esc(r.band) : r.state === 'current' ? '<span class="here">You are here</span>' : ''}</span>
        </div>`).join('')}
    </div>
  </section>`;
}

// ---------------------------------------------------------------- bags
function bagSection(d) {
  const b = d.bags;
  const coach = d.role === 'coach';
  const nextBag = b.released + 1;
  let body;
  if (!b.milestoneSet) {
    body = `<div class="notice warn">${coach
      ? `XP per bag is not set yet. Set it in Settings once two weeks of data exist${b.suggestedMilestone ? ` — the last fortnight's pace suggests <span class="num">${b.suggestedMilestone}</span> XP for about one bag a week` : ''}.`
      : 'Your coach sets the bag target after your first two weeks. Every XP you earn now already counts toward bag 1.'}</div>`;
  } else if (b.complete) {
    body = '<div class="notice">Set complete — every bag earned.</div>';
  } else {
    body = `<div class="bar-row"><span class="big">Bag ${nextBag}</span><span><span class="num effort" id="bag-to-go">${b.xpToNext}</span> <span class="dim small">XP to go</span></span></div>
      ${bar(b.progress * 100, { effort: true, id: 'bag-bar', ticks: [25, 50, 75] })}`;
  }
  const coachInfo = coach
    ? `<div class="stats">
        <div class="stat"><div class="k">XP per bag</div><div class="v">${b.milestone ?? 'not set'}</div></div>
        <div class="stat"><div class="k">XP last 14 days</div><div class="v">${b.xpLast14Days}</div></div>
        <div class="stat"><div class="k">Pace</div><div class="v">${b.pace ? `${b.pace.bagsPerWeek.toFixed(1)}/wk` : '—'}</div></div>
        <div class="stat"><div class="k">Next bag in</div><div class="v">${b.pace && b.pace.daysToNext !== null ? `~${Math.ceil(b.pace.daysToNext)} d` : '—'}</div></div>
      </div>` : '';
  return `<section>
    <div class="section-head"><h2>XP → next Lego bag</h2>
      <span class="aside"><span class="num">${b.released}</span> earned${b.total ? ` · <span class="num">${b.remaining}</span> to go of ${b.total}` : ''}</span></div>
    ${body}
    <div style="margin-top:10px"><span class="chip effort hidden" id="bag-chip">Bag ${b.released} unlocked</span></div>
    ${coachInfo}
  </section>`;
}

// ---------------------------------------------------------------- shelf
function shelfSection(d) {
  const strip = d.bags.strip;
  const rows = [0, 1, 2].map((r) => {
    let cells = '';
    for (let i = 0; i < 3; i++) {
      const slot = r * 3 + i;
      const n = strip.firstBag + slot;
      const filled = slot < strip.filled;
      cells += `<div class="brick${filled ? '' : ' empty'}" data-brick="${n}"><span class="bn">${n}</span></div>`;
    }
    return `<div class="brow${r % 2 ? ' offset' : ''}">${cells}</div>`;
  }).join('');
  return `<section>
    <div class="section-head"><h2>Shelf</h2><span class="aside">Nothing here is ever taken back.</span></div>
    <div class="shelf">
      <div>
        <div class="hero-label">Division badges</div>
        <div class="badges">${d.badges.map((b) => `<div class="badge-wrap"><span class="badge${b.earned ? ' earned' : ''}" data-badge="${esc(b.key)}" title="${esc(b.name)}">${esc(b.numeral)}</span><span class="tiny">${esc(b.name)}</span></div>`).join('')}</div>
      </div>
      <div>
        <div class="hero-label">Brick build${d.bags.total ? ` · bags ${strip.firstBag}–${Math.min(strip.firstBag + 8, d.bags.total)}` : ''}</div>
        <div class="bricks" id="bricks">${rows}</div>
      </div>
    </div>
  </section>`;
}

// ---------------------------------------------------------------- season
function seasonSection(d) {
  const s = d.season;
  const coach = d.role === 'coach';
  const partHtml = (p) => {
    if (p.kind === 'count') {
      return `<div class="part"><span>${esc(p.label)}</span><span>${p.notSet ? '<span class="faint">target not set</span>' : `<span class="num">${p.value}</span><span class="faint"> / ${p.target}</span>`}</span></div>`;
    }
    if (p.kind === 'pct') return `<div class="part"><span>${esc(p.label)}</span><span><span class="num">${p.value}%</span><span class="faint"> / ${p.target}%</span></span></div>`;
    return `<div class="part"><span>${esc(p.label)}</span><span class="mark ${p.met ? 'skill' : 'faint'}">${p.met ? 'Yes' : 'Not yet'}</span></div>`;
  };
  return `<section>
    <div class="section-head"><h2>Season · ${esc(s.label)}</h2>
      <span class="aside"><span class="num">${s.puzzles}</span> puzzles · <span class="num">${s.fullPct}%</span> full${coach ? ` · rating ${Math.round(s.startRating)} → ${Math.round(d.rating)} (<span class="${s.ratingGain >= 0 ? 'pos' : 'neg'}">${fmtDelta(s.ratingGain)}</span>)` : ''}</span></div>
    <div class="tiers">
      ${s.tiers.map((t) => `<div class="tier${t.met ? ' met' : ''}"><h3>${esc(t.label)}<span class="mark ${t.met ? 'skill' : 'faint'}">${t.met ? 'Achieved' : ''}</span></h3>${t.parts.map(partHtml).join('')}</div>`).join('')}
    </div>
  </section>`;
}

// ---------------------------------------------------------------- history
function historySection(d) {
  const coach = d.role === 'coach';
  const all = d.history;
  const rows = all.slice(0, S.historyLimit);
  if (!all.length) return `<section><div class="section-head"><h2>History</h2></div><p class="dim small">No attempts yet.</p></section>`;
  const head = coach
    ? '<tr><th>When</th><th>Puzzle</th><th>Line</th><th>Playing for</th><th>Auto</th><th>Grade</th><th class="num">Δ</th><th class="num">E</th><th class="num">XP</th><th class="num">Time</th><th>By</th></tr>'
    : '<tr><th>When</th><th>Puzzle</th><th>Result</th><th class="num">XP</th><th class="num">Time</th><th>Your line</th><th>Book answer</th></tr>';
  const body = rows.map((h) => {
    const flags = [h.hint ? 'hint' : '', h.selfCall ? 'called wrong' : '', h.reattempt ? 're-attempt' : ''].filter(Boolean).join(' · ');
    if (coach) {
      return `<tr>
        <td class="mono">${esc(fmtWhen(h.at))}</td>
        <td class="mono">${esc(h.puzzle_id)}<div class="tiny faint">${esc(flags)}</div></td>
        <td class="mono">${esc(h.line)}</td>
        <td>${esc(h.objective)}</td>
        <td>${h.autoGrade ? stamp(h.autoGrade, { sm: true }) : ''}</td>
        <td><select data-grade-for="${esc(h.id)}" aria-label="Grade for ${esc(h.puzzle_id)}">
          ${['full', 'partial', 'wrong'].map((g) => `<option value="${g}"${(h.coachGrade || h.autoGrade) === g ? ' selected' : ''}>${GRADE_LABEL[g]}</option>`).join('')}
        </select>${h.provisional ? '<div class="tiny faint">unconfirmed</div>' : ''}${h.hintCapped ? '<div class="tiny faint">capped (hint)</div>' : ''}</td>
        <td class="num mono ${h.delta >= 0 ? 'pos' : 'neg'}">${h.reattempt ? '—' : fmtDelta(h.delta)}</td>
        <td class="num mono">${h.expected !== null ? h.expected.toFixed(2) : '—'}</td>
        <td class="num mono">${h.reattempt ? '—' : h.xp}</td>
        <td class="num mono">${fmtClock(h.elapsed)}</td>
        <td class="small dim">${esc(h.gradedBy || '')}</td>
      </tr>`;
    }
    return `<tr>
      <td class="mono">${esc(fmtWhen(h.at))}</td>
      <td class="mono">${esc(h.puzzle_id)}</td>
      <td>${stamp(h.grade, { provisional: h.provisional, sm: true })}${flags ? `<div class="tiny faint">${esc(flags)}</div>` : ''}</td>
      <td class="num mono">${h.reattempt ? '—' : h.xp}</td>
      <td class="num mono">${fmtClock(h.elapsed)}</td>
      <td class="mono">${esc(h.line)}</td>
      <td class="mono dim">${esc(h.answer)}</td>
    </tr>`;
  }).join('');
  const bonuses = d.bonusLog.length
    ? `<div class="hero-label" style="margin-top:16px">Bonus XP</div>
       <div class="table-wrap"><table><tbody>${d.bonusLog.map((b) => `<tr><td class="mono">${esc(fmtDay(b.at))}</td><td>${esc(b.label)}</td><td class="num mono effort">+${b.xp}</td>${coach ? `<td class="num">${b.id ? `<button class="btn sm" type="button" data-action="award-void" data-id="${esc(b.id)}">Remove</button>` : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
    : '';
  return `<section>
    <div class="section-head"><h2>History</h2><span class="aside">${coach ? 'Change any grade at any time; everything recalculates.' : 'Your attempts, newest first.'}</span></div>
    <div class="table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>
    ${all.length > rows.length ? `<div style="margin-top:8px"><button class="btn sm" type="button" data-action="more-history">Show more <span class="num dim">(${all.length - rows.length})</span></button></div>` : ''}
    ${bonuses}
  </section>`;
}

// ---------------------------------------------------------------- coach: queue
function queueSection(d) {
  const q = d.queue;
  const rows = q.map((h) => {
    const p = puzzleById(h.puzzle_id);
    return `<div class="qrow">
      <div>
        <div class="mono">${esc(h.puzzle_id)}</div>
        ${stars(h.difficulty)}
        <div class="tiny faint">${esc(fmtWhen(h.at))}</div>
      </div>
      <div>
        <div class="qline">${esc(h.line)}</div>
        <div class="qmeta">Playing for: ${h.objective ? esc(h.objective) : '<span class="faint">nothing stated</span>'}</div>
        <div class="qkey">Book: ${esc(h.answer || p?.answer || '—')}</div>
        <div class="qmeta small">${esc(h.autoReason || '')}</div>
        <div class="flags">
          ${h.hint ? '<span class="chip">Hint used · max partial</span>' : ''}
          ${h.selfCall ? '<span class="chip">He called it wrong</span>' : ''}
          <span class="chip">Time ${fmtClock(h.elapsed)}${h.clock ? ` / ${fmtClock(h.clock)}` : ''}</span>
          <span class="chip">Δ ${fmtDelta(h.delta)}</span>
        </div>
      </div>
      <div class="qactions">
        <div style="width:100%;text-align:right">${stamp(h.autoGrade, { sm: true, provisional: true })}</div>
        <button class="btn primary sm" type="button" data-action="grade" data-id="${esc(h.id)}" data-grade="${esc(h.autoGrade)}">Confirm</button>
        <button class="btn sm grade-full" type="button" data-action="grade" data-id="${esc(h.id)}" data-grade="full">Full</button>
        <button class="btn sm" type="button" data-action="grade" data-id="${esc(h.id)}" data-grade="partial">Partial</button>
        <button class="btn sm grade-wrong" type="button" data-action="grade" data-id="${esc(h.id)}" data-grade="wrong">Wrong</button>
      </div>
    </div>`;
  }).join('');
  return `<section id="queue">
    <div class="section-head"><h2>Verification queue</h2><span class="aside"><span class="num">${q.length}</span> waiting</span></div>
    ${q.length ? `<div class="queue">${rows}</div>` : '<p class="dim small">Nothing to review.</p>'}
  </section>`;
}

// ---------------------------------------------------------------- coach: rewards
function rewardsSection(d) {
  const r = d.rewards;
  return `<section>
    <div class="section-head"><h2>Rewards to hand over</h2><span class="aside">Mark each physical reward once it's given. Handed-over rewards are never taken back.</span></div>
    ${r.pending.length ? r.pending.map((p) => `<div class="reward-row">
        <span><span class="${p.kind === 'bag' ? 'effort' : 'skill'} display">${esc(p.label)}</span> <span class="small dim">earned ${esc(fmtDay(p.earnedAt))}</span></span>
        <button class="btn sm" type="button" data-action="handover" data-kind="${esc(p.kind)}" data-item="${esc(p.item)}">Handed over</button>
      </div>`).join('') : '<p class="dim small">Nothing waiting.</p>'}
    ${r.handed.length ? `<div class="hero-label" style="margin-top:12px">Handed over</div>${r.handed.slice(0, 12).map((h) => `<div class="reward-row small">
        <span>${h.kind === 'bag' ? `Lego bag ${esc(h.item)}` : `${esc(h.item)} collectible`} <span class="dim">· ${esc(fmtDay(h.at))} · ${esc(h.by)}</span></span>
        <button class="btn sm" type="button" data-action="handover-undo" data-id="${esc(h.id)}">Undo</button></div>`).join('')}` : ''}
    <form id="award-form" class="row-form" style="margin-top:16px">
      <label class="field">Award XP<input type="number" name="xp" min="1" max="500" step="1" required></label>
      <label class="field wide" style="grid-column: span 3">Reason<input type="text" name="note" maxlength="200" placeholder="e.g. timer failed, beat the clock"></label>
      <button class="btn" type="submit">Award</button>
    </form>
  </section>`;
}

// ---------------------------------------------------------------- coach: admin
function adminSection(d) {
  const filter = S.puzzleFilter.trim();
  const list = S.puzzles.filter((p) => !filter || p.id.startsWith(filter) || `${p.set}.` === filter);
  const shown = list.slice(0, 80);
  const ep = S.editPuzzle ? puzzleById(S.editPuzzle) : null;
  const groups = [];
  for (const c of d.config) {
    let g = groups.find((x) => x.name === c.group);
    if (!g) groups.push((g = { name: c.group, items: [] }));
    g.items.push(c);
  }
  const det = (id, title, inner) => `<details class="admin" data-id="${id}"${S.open.has(id) ? ' open' : ''}><summary>${title}</summary><div class="inner">${inner}</div></details>`;

  const puzzlesInner = `
    <form id="puzzle-form" class="row-form">
      <label class="field">Puzzle<input type="text" name="id" required placeholder="4.7" value="${esc(ep?.id || '')}" class="line-input"></label>
      <label class="field">Difficulty<select name="difficulty">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}"${(ep?.difficulty || 3) === n ? ' selected' : ''}>${n} ★</option>`).join('')}</select></label>
      <label class="field wide">Answer (main line; alternatives with |)<input type="text" name="answer" class="line-input" value="${esc(ep?.answer || '')}" placeholder="Nxf7+ Kxf7 Qh5+ Kg8 Qd5#"></label>
      <label class="field wide">Hint<input type="text" name="hint" value="${esc(ep?.hint || '')}"></label>
      <label class="field">Clock (sec)<input type="number" name="clock_seconds" min="1" step="1" value="${esc(ep?.clock_seconds || '')}" placeholder="optional"></label>
      <div class="wide" style="grid-column: 1 / -1; display:flex; gap:8px">
        <button class="btn primary" type="submit">${ep ? 'Save puzzle' : 'Add puzzle'}</button>
        ${ep ? '<button class="btn" type="button" data-action="edit-cancel">Cancel</button>' : ''}
      </div>
    </form>
    <div class="picker">
      <label class="field">Filter (e.g. 4. or 4.7)<input type="text" id="puzzle-filter" value="${esc(S.puzzleFilter)}" placeholder="all"></label>
      <span class="small dim"><span class="num">${S.puzzles.length}</span> puzzles · <span class="num">${S.puzzles.filter((p) => !p.hasAnswer).length}</span> without an answer</span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Puzzle</th><th>Diff</th><th>Answer</th><th class="num">Clock</th><th class="num">Tries</th><th></th></tr></thead>
      <tbody>${shown.map((p) => `<tr>
        <td class="mono">${esc(p.id)}</td><td>${stars(p.difficulty)}</td>
        <td class="mono">${p.answer ? esc(p.answer) : '<span class="miss small">no answer</span>'}</td>
        <td class="num mono">${p.clock_seconds ? fmtClock(p.clock_seconds) : ''}</td>
        <td class="num mono">${p.attempts}</td>
        <td class="num"><button class="btn sm" type="button" data-action="edit-puzzle" data-pid="${esc(p.id)}">Edit</button></td>
      </tr>`).join('')}</tbody>
    </table></div>
    ${list.length > shown.length ? `<p class="small dim">Showing ${shown.length} of ${list.length}. Use the filter to narrow down.</p>` : ''}`;

  const importInner = `
    <p class="small dim">Paste CSV with a header row. Columns: <span class="mono">id,difficulty,answer,hint,clock_seconds,notes</span> (only <span class="mono">id</span> and <span class="mono">difficulty</span> are required). Existing puzzles with the same id are updated. Wrap a value in double quotes if it contains a comma.</p>
    <form id="import-form" class="form-grid">
      <textarea name="csv" class="line-input" rows="8" placeholder="id,difficulty,answer,hint,clock_seconds&#10;1.1,2,Nxf7+ Kxf7 Qh5+,Look at f7,&#10;1.2,3,Rxe8+ Qxe8 Qxh7#,,120"></textarea>
      <div><button class="btn primary" type="submit">Import</button></div>
    </form>`;

  const settingsInner = `
    <p class="small dim">Changes apply from now on; past results keep the values they were scored with. Blank = not set.</p>
    <form id="config-form">
      <div class="cfg-grid">
        ${groups.map((g) => `<h4>${esc(g.name)}</h4>${g.items.map((c) => `
          <label for="cfg-${c.key}" class="small">${esc(c.label)}${c.default !== null && c.value !== c.default ? ` <span class="faint">(default ${c.default})</span>` : ''}</label>
          <span class="${c.value === null ? 'unset' : ''}"><input id="cfg-${c.key}" type="number" step="any" min="0" name="${esc(c.key)}" value="${c.value ?? ''}" placeholder="not set" class="num"></span>`).join('')}`).join('')}
      </div>
      <div style="margin-top:12px"><button class="btn primary" type="submit">Save settings</button></div>
    </form>
    ${d.configHistory.length ? `<div class="hero-label" style="margin-top:12px">Recent changes</div><div class="table-wrap"><table><tbody>${d.configHistory.slice(0, 12).map((h) => `<tr><td class="mono">${esc(fmtWhen(h.effective_from))}</td><td class="mono">${esc(h.key)}</td><td class="num mono">${esc(h.value || 'not set')}</td><td class="small dim">${esc(h.changed_by)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;

  return `<section>
    <div class="section-head"><h2>Admin</h2></div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${det('puzzles', `Puzzles &amp; answers <span class="num dim">${S.puzzles.length}</span>`, puzzlesInner)}
      ${det('import', 'Import from CSV', importInner)}
      ${det('settings', 'Settings', settingsInner)}
    </div>
  </section>`;
}

// ---------------------------------------------------------------- render
function render() {
  const d = S.data;
  if (!d || S.playing) return;
  const coach = d.role === 'coach';
  const sections = coach
    ? [hero(d), queueSection(d), divisionSection(d), bagSection(d), shelfSection(d), seasonSection(d), rewardsSection(d), historySection(d), adminSection(d)]
    : [attemptSection(d), hero(d), divisionSection(d), bagSection(d), shelfSection(d), seasonSection(d), historySection(d)];
  app.innerHTML = header(d) + `<main>${sections.join('')}</main>`;
  tick();
}

function tick() {
  const el = document.getElementById('timer');
  if (!el) return;
  const elapsed = (Date.now() + S.skew - Date.parse(el.dataset.start)) / 1000;
  el.textContent = fmtClock(elapsed);
  const clock = Number(el.dataset.clock);
  el.classList.toggle('over', !!clock && elapsed > clock);
}
setInterval(tick, 250);

// ---------------------------------------------------------------- actions
async function act(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
  } catch (e) {
    toast(e.message, true);
  }
}

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const a = el.dataset.action;
  const d = S.data;
  if (a === 'theme') { cycleTheme(); render(); return; }
  if (a === 'logout') { act(async () => { await api('logout', {}); S.me = null; S.data = null; renderLogin(); }); return; }
  if (a === 'view') { S.view = el.dataset.view; S.result = null; act(() => load()); return; }
  if (a === 'play') {
    if (!d?.replay || S.playing) return;
    S.playing = true;
    el.disabled = true;
    playSession(d, { stepWidth: STEP_WIDTH }).finally(() => { S.playing = false; render(); });
    return;
  }
  if (a === 'pick') { S.pick = el.dataset.pid; const p = puzzleById(S.pick); if (p) S.setSel = p.set; render(); return; }
  if (a === 'browse') { S.browse = true; S.pick = null; render(); return; }
  if (a === 'next-unsolved') {
    const p = S.puzzles.find((x) => !x.attempted);
    if (!p) { toast('Every puzzle has been attempted.'); return; }
    S.pick = p.id; S.setSel = p.set; render(); return;
  }
  if (a === 'start') {
    act(async () => {
      const r = await api('attempts/start', { puzzle_id: el.dataset.pid });
      S.pick = r.attempt.puzzle_id;
      S.browse = false;
      await load({ puzzles: false });
      document.querySelector('#finish-form input[name=line]')?.focus();
    }, null);
    return;
  }
  if (a === 'next') { S.result = null; S.pick = null; S.browse = false; act(() => load()); return; }
  if (a === 'grade') {
    el.disabled = true;
    act(async () => { await api('coach/grade', { id: el.dataset.id, grade: el.dataset.grade }); await load({ puzzles: false }); }, 'Graded');
    return;
  }
  if (a === 'handover') { act(async () => { await api('coach/handovers', { kind: el.dataset.kind, item: el.dataset.item }); await load({ puzzles: false }); }, 'Marked as handed over'); return; }
  if (a === 'handover-undo') { act(async () => { await api('coach/handovers/void', { id: el.dataset.id }); await load({ puzzles: false }); }, 'Undone'); return; }
  if (a === 'award-void') { act(async () => { await api('coach/awards/void', { id: el.dataset.id }); await load({ puzzles: false }); }, 'Award removed'); return; }
  if (a === 'edit-puzzle') { S.editPuzzle = el.dataset.pid; S.open.add('puzzles'); render(); document.querySelector('#puzzle-form')?.scrollIntoView({ block: 'center' }); return; }
  if (a === 'edit-cancel') { S.editPuzzle = null; render(); return; }
  if (a === 'more-history') { S.historyLimit += 50; render(); }
});

app.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'set-select') { S.setSel = t.value; S.pick = null; render(); return; }
  if (t.dataset.gradeFor) {
    act(async () => { await api('coach/grade', { id: t.dataset.gradeFor, grade: t.value }); await load({ puzzles: false }); }, 'Grade changed — everything recalculated');
  }
});

app.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'puzzle-filter') {
    S.puzzleFilter = t.value;
    const pos = t.selectionStart;
    render();
    const f = document.getElementById('puzzle-filter');
    f?.focus();
    f?.setSelectionRange(pos, pos);
    return;
  }
  const form = t.closest('#finish-form');
  if (form) {
    const fd = new FormData(form);
    store.set(`pl-draft-${form.dataset.id}`, JSON.stringify({ line: fd.get('line'), objective: fd.get('objective'), hint_used: fd.has('hint_used'), self_called_wrong: fd.has('self_called_wrong') }));
  }
});
app.addEventListener('toggle', (e) => {
  const det = e.target;
  if (det.matches?.('details.admin')) det.open ? S.open.add(det.dataset.id) : S.open.delete(det.dataset.id);
}, true);

app.addEventListener('submit', (e) => {
  const f = e.target;
  e.preventDefault();
  const fd = new FormData(f);
  const btn = f.querySelector('button[type=submit]');
  const busy = (on) => { if (btn) btn.disabled = on; };

  if (f.id === 'login-form') {
    busy(true);
    api('login', { password: fd.get('password') })
      .then(async (r) => { S.me = { role: r.role, name: r.name }; S.view = r.role === 'coach' ? 'coach' : 'student'; await load(); })
      .catch((err) => renderLogin(err.message));
    return;
  }
  if (f.id === 'finish-form') {
    busy(true);
    const id = f.dataset.id;
    act(async () => {
      try {
        const r = await api('attempts/finish', { id, line: fd.get('line'), objective: fd.get('objective'), hint_used: fd.has('hint_used'), self_called_wrong: fd.has('self_called_wrong') });
        store.set(`pl-draft-${id}`, null);
        S.result = r.result;
        S.pick = null;
        await load();
        document.getElementById('attempt')?.scrollIntoView({ block: 'start' });
      } finally { busy(false); }
    });
    return;
  }
  if (f.id === 'jump-form') {
    const pid = String(fd.get('pid') || '').trim();
    const p = puzzleById(pid);
    if (!p) { toast(`Puzzle ${pid} is not in the system.`, true); return; }
    S.pick = p.id; S.setSel = p.set; render();
    return;
  }
  if (f.id === 'puzzle-form') {
    busy(true);
    const p = { id: fd.get('id'), difficulty: Number(fd.get('difficulty')), answer: fd.get('answer'), hint: fd.get('hint'), clock_seconds: fd.get('clock_seconds') };
    act(async () => {
      try { await api('coach/puzzles', { puzzles: [p] }); S.editPuzzle = null; await load(); } finally { busy(false); }
    }, `Saved ${p.id}`);
    return;
  }
  if (f.id === 'import-form') {
    busy(true);
    act(async () => {
      try { const r = await api('coach/puzzles/import', { csv: fd.get('csv') }); await load(); toast(`Imported ${r.saved} puzzles`); } finally { busy(false); }
    });
    return;
  }
  if (f.id === 'config-form') {
    busy(true);
    const values = {};
    for (const [k, v] of fd.entries()) values[k] = String(v).trim() === '' ? null : v;
    act(async () => {
      try { const r = await api('coach/config', { values }); await load({ puzzles: false }); toast(r.changed ? `Saved ${r.changed} change${r.changed > 1 ? 's' : ''}` : 'No changes'); } finally { busy(false); }
    });
    return;
  }
  if (f.id === 'award-form') {
    busy(true);
    act(async () => {
      try { await api('coach/awards', { xp: Number(fd.get('xp')), note: fd.get('note') }); await load({ puzzles: false }); } finally { busy(false); }
    }, 'XP awarded');
  }
});

// ---------------------------------------------------------------- boot
(async function boot() {
  try {
    const { user } = await api('me');
    if (!user) return renderLogin();
    S.me = user;
    S.view = user.role === 'coach' ? 'coach' : 'student';
    await load();
    if (location.hash === '#queue') document.getElementById('queue')?.scrollIntoView();
  } catch (e) {
    app.innerHTML = `<div class="notice err" style="margin-top:20vh">${esc(e.message)}</div>`;
  }
})();
