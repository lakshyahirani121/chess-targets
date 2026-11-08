// The one orchestrated sequence (design doc §6). Nothing else animates.
// The page is already rendered in its finished state; this snaps it back to the
// state before the latest session in 0ms, then plays the beats. Beats that did not
// happen in that session (no promotion, no new bag) are skipped.

const byId = (id) => document.getElementById(id);
const OUT = 'cubic-bezier(.2,.8,.2,1)';
const STAMP = 'cubic-bezier(.34,1.3,.64,1)';
const FILL = 'cubic-bezier(.4,0,.2,1)';
const CLIMB = 'cubic-bezier(.34,1.4,.64,1)';
const DROP = 'cubic-bezier(.34,1.56,.64,1)';
const ROW = 45; // 44px row + 1px separator

export function playSession(d, { stepWidth }) {
  const r = d.replay;
  const coach = d.role === 'coach';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const D = (ms) => (reduce ? 1 : ms);
  const anim = (el, frames, ms, easing = 'linear') => el && el.animate(frames, { duration: D(ms), easing, fill: 'forwards' });
  const timers = [];
  const at = (ms, fn) => timers.push(new Promise((res) => setTimeout(() => { try { fn(); } finally { res(); } }, reduce ? 0 : ms)));

  function count(el, from, to, ms, fmt = (v) => String(Math.round(v))) {
    if (!el) return;
    if (reduce || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = 1 - (1 - t) ** 3; // ease-out
      el.textContent = fmt(from + (to - from) * e);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  const card = byId('session-card');
  const starEls = card ? [...card.querySelectorAll('.star')] : [];
  const stampEl = card?.querySelector('.stamp');
  const ratingEl = byId('rating-count');
  const xpEl = byId('xp-count');
  const divFill = document.querySelector('#div-bar .fill');
  const marker = byId('ladder-marker');
  const rows = [...document.querySelectorAll('.lrow')]; // top first
  const posOf = (index) => rows.findIndex((row) => Number(row.dataset.divIndex) === index);
  const bagFill = document.querySelector('#bag-bar .fill');
  const bagToGo = byId('bag-to-go');
  const chip = byId('bag-chip');

  const divFrom = coach ? r.fraction.from * 100 : stepWidth[r.step.from];
  const divTo = coach ? r.fraction.to * 100 : stepWidth[r.step.to];
  const gained = Math.max(0, r.xp.to - r.xp.from);
  const bagUnlocked = r.bags.to > r.bags.from;
  const b = d.bags;
  const milestoneGuess = b.milestoneSet && b.progress < 1 && b.xpToNext ? b.xpToNext / (1 - b.progress) : null;
  const bagFrom = bagUnlocked || !milestoneGuess ? 0 : Math.max(0, b.progress * 100 - (gained / milestoneGuess) * 100);
  const bagTo = (b.progress || 0) * 100;

  // ---- snap to the prior state (0ms) ---------------------------------------
  if (card) card.style.opacity = '0';
  starEls.forEach((s) => { s.style.opacity = '0'; });
  if (stampEl) stampEl.style.opacity = '0';
  if (ratingEl && r.rating) ratingEl.textContent = String(Math.round(r.rating.from));
  if (xpEl) xpEl.textContent = String(r.xp.from);
  if (divFill) divFill.style.width = `${divFrom}%`;
  if (bagFill) bagFill.style.width = `${bagFrom}%`;
  if (bagToGo && !bagUnlocked) bagToGo.textContent = String(Number(bagToGo.textContent) + gained);

  let oldRow = null;
  let newRow = null;
  let newRowState = 'held';
  if (r.promoted && posOf(r.division.from) >= 0) {
    oldRow = rows[posOf(r.division.from)];
    newRow = rows[posOf(r.division.to)];
    newRowState = r.newBadges.includes(d.ladder.find((x) => x.index === r.division.to)?.key) ? 'locked' : 'held';
    newRow.classList.remove('current');
    newRow.classList.add(newRowState);
    oldRow.classList.remove('held', 'locked');
    oldRow.classList.add('current');
    if (!coach) {
      oldRow.querySelector('.lband').innerHTML = newRow.querySelector('.lband').innerHTML;
      newRow.querySelector('.lband').innerHTML = '';
    }
    if (marker) marker.style.top = `${posOf(r.division.from) * ROW}px`;
  }
  const badgeEls = r.newBadges.map((k) => document.querySelector(`[data-badge="${k}"]`)).filter(Boolean);
  badgeEls.forEach((el) => el.classList.remove('earned'));
  const newBricks = [];
  if (bagUnlocked) {
    for (let n = r.bags.from + 1; n <= r.bags.to; n++) {
      const el = document.querySelector(`[data-brick="${n}"]`);
      if (el) { el.classList.add('empty'); newBricks.push(el); }
    }
  }
  if (chip) chip.classList.add('hidden');
  void document.body.offsetWidth; // commit the snapped state

  // ---- the sequence ---------------------------------------------------------
  at(0, () => {
    if (!card) return;
    card.style.opacity = '';
    anim(card, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], 320, OUT);
  });
  at(320, () => {
    starEls.forEach((s, i) => {
      s.style.opacity = '';
      s.animate([{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'scale(1)' }], { duration: D(140), delay: reduce ? 0 : i * 60, easing: OUT, fill: 'both' });
    });
  });
  at(620, () => {
    if (!stampEl) return;
    stampEl.style.opacity = '';
    anim(stampEl, [{ opacity: 0, transform: 'rotate(-3deg) scale(1.25)' }, { opacity: 1, transform: 'rotate(-3deg) scale(1)' }], 240, STAMP);
  });
  at(900, () => {
    if (coach && r.rating) count(ratingEl, r.rating.from, r.rating.to, 700);
    if (divFill) anim(divFill, [{ width: `${divFrom}%` }, { width: `${r.promoted ? 100 : divTo}%` }], 800, FILL);
  });
  if (r.promoted) {
    at(1700, () => {
      if (!divFill) return;
      const css = getComputedStyle(document.documentElement);
      const skill = css.getPropertyValue('--skill').trim();
      const flash = css.getPropertyValue('--flash').trim();
      divFill.animate([{ background: skill }, { background: flash }, { background: skill }], { duration: D(200) });
    });
    at(1800, () => {
      if (marker && newRow) {
        const from = posOf(r.division.from) * ROW;
        const to = posOf(r.division.to) * ROW;
        marker.style.top = `${to}px`;
        anim(marker, [{ top: `${from}px` }, { top: `${to}px` }], 420, CLIMB);
      }
      if (oldRow && newRow) {
        oldRow.classList.remove('current');
        oldRow.classList.add('held'); // fades over 300ms via the row's colour transition
        newRow.classList.remove(newRowState);
        newRow.classList.add('current');
        if (!coach) {
          newRow.querySelector('.lband').innerHTML = oldRow.querySelector('.lband').innerHTML;
          oldRow.querySelector('.lband').innerHTML = '';
        }
      }
    });
    at(1950, () => {
      if (divFill) anim(divFill, [{ width: '0%' }, { width: `${divTo}%` }], 400, FILL);
    });
  }
  if (badgeEls.length) {
    at(2100, () => badgeEls.forEach((el) => {
      el.classList.add('earned');
      anim(el, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], 360, CLIMB);
    }));
  }
  at(2400, () => {
    count(xpEl, r.xp.from, r.xp.to, 600);
    if (bagToGo && !bagUnlocked) count(bagToGo, Number(bagToGo.textContent), b.xpToNext, 600);
    if (bagFill) anim(bagFill, [{ width: `${bagFrom}%` }, { width: `${bagTo}%` }], 700, FILL);
  });
  if (bagUnlocked) {
    at(3000, () => {
      if (!chip) return;
      chip.classList.remove('hidden');
      anim(chip, [{ opacity: 0, transform: 'translateX(-8px)' }, { opacity: 1, transform: 'translateX(0)' }], 280, OUT);
    });
    at(3200, () => newBricks.forEach((el) => {
      el.classList.remove('empty');
      anim(el, [{ transform: 'translateY(-40px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], 420, DROP);
    }));
    at(3620, () => newBricks.forEach((el) => {
      el.style.transformOrigin = '50% 100%';
      anim(el, [{ transform: 'scaleY(1.06)' }, { transform: 'scaleY(.94)' }, { transform: 'scaleY(1)' }], 120, 'ease-out');
    }));
  }

  // Total 3.74s; resolve once the last beat has finished.
  return Promise.all([...timers, new Promise((res) => setTimeout(res, reduce ? 50 : 3740))]);
}
