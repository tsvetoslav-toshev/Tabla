/* Screen, input and animation. The rules live in engine.js; this file only
 * asks the engine what is legal and shows it. */
(function () {
  'use strict';
  const E = window.TablaEngine;
  const Sound = window.TablaSound;
  const { LIGHT, DARK, BAR, OFF } = E;

  const $ = (s) => document.querySelector(s);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const dur = (ms) => (reduced.matches ? 1 : ms);
  const wait = (ms) => new Promise((r) => setTimeout(r, dur(ms)));
  const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  const EASE_IN_OUT = 'cubic-bezier(0.45, 0, 0.25, 1)';
  const STORE = 'tabla.v1';

  // ---------- geometry (board units; the board is scaled to fit) ----------
  const G = {
    W: 1000, H: 780, TOP: 25, BOTTOM: 755, MID: 390, PW: 65, PH: 300, D: 58,
    BAR_L: 415, BAR_R: 475, BAR_X: 445, TRAY_L: 890, TRAY_R: 975, TRAY_X: 932.5,
    LEFT_L: 25, RIGHT_L: 475, RIGHT_R: 865,
    SIDE_X: [670, 220], // where each player's dice land: light on the right half, dark on the left
  };
  const R = G.D / 2;
  const KEYS = [...Array.from({ length: 24 }, (_, i) => 'p' + i), 'bar', 'off'];

  function pointX(i) {
    if (i < 6) return G.RIGHT_R - G.PW * (i + 0.5);
    if (i < 12) return G.BAR_L - G.PW * (i - 6 + 0.5);
    if (i < 18) return G.LEFT_L + G.PW * (i - 12 + 0.5);
    return G.RIGHT_L + G.PW * (i - 18 + 0.5);
  }
  const isTop = (i) => i >= 12;

  /** Where the i-th of n checkers in a stack sits. */
  function slot(p, key, i, n) {
    if (key === 'off') {
      return { x: G.TRAY_X, y: p === LIGHT ? G.BOTTOM - 12 - i * 19 : G.TOP + 12 + i * 19 };
    }
    if (key === 'bar') {
      const sp = n <= 1 ? G.D : Math.min(G.D, (G.PH - 30 - G.D) / (n - 1));
      return { x: G.BAR_X, y: p === LIGHT ? G.MID + 36 + R + i * sp : G.MID - 36 - R - i * sp };
    }
    const idx = +key.slice(1);
    const sp = n <= 5 ? G.D : (G.PH - G.D) / (n - 1);
    return { x: pointX(idx), y: isTop(idx) ? G.TOP + R + i * sp : G.BOTTOM - R - i * sp };
  }

  function locAt(x, y) {
    if (y < G.TOP - 10 || y > G.BOTTOM + 10) return null;
    if (x >= G.TRAY_L - 10 && x <= G.TRAY_R + 10) return OFF;
    if (x >= G.BAR_L && x < G.BAR_R) return BAR;
    const top = y < G.MID;
    if (x >= G.LEFT_L && x < G.BAR_L) {
      const c = Math.floor((x - G.LEFT_L) / G.PW);
      return top ? 12 + c : 11 - c;
    }
    if (x >= G.RIGHT_L && x < G.RIGHT_R) {
      const c = Math.floor((x - G.RIGHT_L) / G.PW);
      return top ? 18 + c : 5 - c;
    }
    return null;
  }
  const keyOf = (loc) => (typeof loc === 'number' ? 'p' + loc : loc);

  // ---------- state ----------
  let state = null;
  let history = [];
  let rollLog = {}; // dice already thrown for a turn: undo never re-rolls
  let settings = { sound: true, autoDone: false };
  let matchLength = 5;
  let busy = false;
  let selected = null; // { from, dests: Map<string, move[]> }
  let movesNow = [];
  let sources = new Set();
  let drag = null;
  let scale = 1;
  let started = false; // nothing is saved until a match is started or resumed

  // ---------- board art ----------
  function buildBoardArt() {
    const tri = [];
    for (let i = 0; i < 24; i++) {
      const x = pointX(i);
      const top = isTop(i);
      const y0 = top ? G.TOP : G.BOTTOM;
      const y1 = top ? G.TOP + G.PH - 8 : G.BOTTOM - G.PH + 8;
      const a = i % 2 === 0;
      tri.push(`<polygon points="${x - 31},${y0} ${x + 31},${y0} ${x},${y1}" fill="url(#${a ? 'triA' : 'triB'}${top ? 't' : 'b'})" stroke="rgba(0,0,0,.25)" stroke-width="1"/>`);
      tri.push(`<polygon points="${x - 22},${y0} ${x + 22},${y0} ${x},${top ? y1 - 40 : y1 + 40}" fill="none" stroke="${a ? 'rgba(90,40,20,.25)' : 'rgba(255,235,200,.14)'}" stroke-width="1.2"/>`);
    }
    const labels = [];
    for (let i = 0; i < 24; i++) {
      labels.push(`<text id="lbl${i}" x="${pointX(i)}" y="${isTop(i) ? 17 : 770}" text-anchor="middle"></text>`);
    }
    const field = (x) => `<rect x="${x}" y="${G.TOP}" width="390" height="730" rx="6" fill="url(#felt)"/>
      <rect x="${x}" y="${G.TOP}" width="390" height="730" rx="6" fill="url(#vignette)"/>
      <rect x="${x}" y="${G.TOP}" width="390" height="730" rx="6" filter="url(#feltGrain)" opacity=".5"/>`;
    const hinge = (y) => `<rect x="${G.BAR_X - 13}" y="${y}" width="26" height="46" rx="4" fill="url(#brass)" stroke="rgba(0,0,0,.35)"/>
      <circle cx="${G.BAR_X}" cy="${y + 10}" r="2.4" fill="rgba(60,40,10,.7)"/><circle cx="${G.BAR_X}" cy="${y + 36}" r="2.4" fill="rgba(60,40,10,.7)"/>`;
    $('#boardArt').innerHTML = `
      <defs>
        <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#6d4428"/><stop offset=".5" stop-color="#553320"/><stop offset="1" stop-color="#3e2415"/>
        </linearGradient>
        <filter id="grain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.22" numOctaves="3" seed="7"/>
          <feColorMatrix values="0 0 0 0 0.12  0 0 0 0 0.06  0 0 0 0 0.02  0 0 0 0.55 -0.05"/>
          <feComposite in2="SourceGraphic" operator="in"/>
        </filter>
        <filter id="feltGrain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/>
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.22 0"/>
          <feComposite in2="SourceGraphic" operator="in"/>
        </filter>
        <radialGradient id="felt" cx=".5" cy=".5" r=".75">
          <stop offset="0" stop-color="#2c5443"/><stop offset="1" stop-color="#173428"/>
        </radialGradient>
        <radialGradient id="vignette" cx=".5" cy=".5" r=".7">
          <stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/>
        </radialGradient>
        <linearGradient id="triAt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eadbb8"/><stop offset="1" stop-color="#cdb48a"/></linearGradient>
        <linearGradient id="triAb" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#eadbb8"/><stop offset="1" stop-color="#cdb48a"/></linearGradient>
        <linearGradient id="triBt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b85a3c"/><stop offset="1" stop-color="#86351f"/></linearGradient>
        <linearGradient id="triBb" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#b85a3c"/><stop offset="1" stop-color="#86351f"/></linearGradient>
        <linearGradient id="brass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a6a2c"/><stop offset=".5" stop-color="#e8c878"/><stop offset="1" stop-color="#8a6a2c"/></linearGradient>
        <linearGradient id="tray" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1b100a"/><stop offset=".5" stop-color="#2a1a10"/><stop offset="1" stop-color="#1b100a"/></linearGradient>
      </defs>
      <rect width="1000" height="780" rx="22" fill="url(#wood)"/>
      <rect width="1000" height="780" rx="22" filter="url(#grain)"/>
      <rect x="3" y="3" width="994" height="774" rx="20" fill="none" stroke="rgba(255,220,170,.18)" stroke-width="2"/>
      ${field(G.LEFT_L)}${field(G.RIGHT_L)}
      <g>${tri.join('')}</g>
      <rect x="${G.LEFT_L}" y="${G.TOP}" width="390" height="730" rx="6" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="4"/>
      <rect x="${G.RIGHT_L}" y="${G.TOP}" width="390" height="730" rx="6" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="4"/>
      <rect x="${G.BAR_L + 6}" y="${G.TOP}" width="${G.BAR_R - G.BAR_L - 12}" height="730" rx="8" fill="rgba(0,0,0,.18)"/>
      ${hinge(150)}${hinge(584)}
      <rect x="${G.TRAY_L}" y="${G.TOP}" width="85" height="730" rx="10" fill="url(#tray)" stroke="rgba(0,0,0,.6)" stroke-width="3"/>
      <rect x="${G.TRAY_L}" y="${G.MID - 3}" width="85" height="6" fill="url(#wood)"/>
      <g class="labels" font-family="system-ui, sans-serif" font-size="12" font-weight="600" fill="rgba(255,236,200,.55)">${labels.join('')}</g>`;
  }

  function buildHighlights() {
    const box = $('#hls');
    for (let i = 0; i < 24; i++) {
      const d = document.createElement('div');
      d.className = 'hl pt ' + (isTop(i) ? 'top' : 'bottom');
      d.style.left = pointX(i) - G.PW / 2 + 'px';
      d.style.top = (isTop(i) ? G.TOP : G.BOTTOM - G.PH) + 'px';
      d.dataset.key = String(i);
      box.appendChild(d);
    }
    for (const p of [LIGHT, DARK]) {
      const d = document.createElement('div');
      d.className = 'hl tray';
      d.style.left = G.TRAY_L + 'px';
      d.style.top = (p === LIGHT ? G.MID : G.TOP) + 'px';
      d.dataset.key = 'off' + p;
      box.appendChild(d);
    }
  }
  const hlFor = (loc) => document.querySelector(`.hl[data-key="${loc === OFF ? 'off' + state.turn : loc}"]`);

  // ---------- checkers ----------
  const stacks = [new Map(), new Map()];
  const tr = (pos) => `translate(${pos.x - R}px, ${pos.y - R}px)`;

  function buildCheckers() {
    const box = $('#checkers');
    for (const p of [LIGHT, DARK]) {
      for (const key of KEYS) stacks[p].set(key, []);
      for (let n = 0; n < E.CHECKERS; n++) {
        const el = document.createElement('div');
        el.className = 'checker slab ' + (p === LIGHT ? 'light' : 'dark');
        el.innerHTML = '<div class="lift"><div class="face"></div><div class="count"></div></div>';
        el._p = p;
        box.appendChild(el);
        stacks[p].get('off').push(el);
      }
    }
  }

  function targetCount(board, p, key) {
    if (key === 'bar') return board.bar[p];
    if (key === 'off') return board.off[p];
    return E.countAt(board, +key.slice(1), p);
  }

  function place(el, pos) {
    el._x = pos.x; el._y = pos.y;
    el.style.transform = tr(pos);
  }

  function flyTo(el, pos, { delay = 0, onLand, fromDrag = false } = {}) {
    const from = { x: el._x, y: el._y };
    place(el, pos);
    const dist = Math.hypot(pos.x - from.x, pos.y - from.y);
    const d = dur(Math.min(760, 300 + dist * 0.42));
    const dl = dur(delay);
    el.style.zIndex = String(600 + Math.round(delay / 10));
    if (!fromDrag) setTimeout(() => el.classList.add('lifted'), dl);
    setTimeout(() => el.classList.remove('lifted', 'dragging'), dl + d * 0.72);
    const a = el.animate([{ transform: tr(from) }, { transform: tr(pos) }], { duration: d, delay: dl, easing: EASE_IN_OUT, fill: 'backwards' });
    return a.finished.catch(() => {}).then(() => {
      el.style.zIndex = String(el._z);
      if (onLand) onLand(el);
    });
  }

  function slideTo(el, pos) {
    const from = { x: el._x, y: el._y };
    place(el, pos);
    return el.animate([{ transform: tr(from) }, { transform: tr(pos) }], { duration: dur(220), easing: EASE_OUT }).finished.catch(() => {});
  }

  /**
   * Makes the checkers on screen match `board`. Only the checkers that must
   * change place move, so one call animates a move, a hit, an undo of several
   * moves or a whole new game alike.
   */
  function reconcile(board, { animate = true, mover = null, hitDelay = 0, stagger = 0, dragged = null, onLand } = {}) {
    const moved = new Set();
    for (const p of [LIGHT, DARK]) {
      const surplus = [];
      for (const key of KEYS) {
        const arr = stacks[p].get(key);
        const t = targetCount(board, p, key);
        while (arr.length > t) surplus.push(arr.pop());
      }
      for (const key of KEYS) {
        const arr = stacks[p].get(key);
        const t = targetCount(board, p, key);
        while (arr.length < t) {
          const el = surplus.shift();
          arr.push(el);
          moved.add(el);
        }
      }
    }
    const jobs = [];
    let order = 0;
    for (const p of [LIGHT, DARK]) {
      for (const key of KEYS) {
        const arr = stacks[p].get(key);
        arr.forEach((el, i) => {
          const pos = slot(p, key, i, arr.length);
          el._z = 10 + i;
          const showCount = key !== 'off' && i === arr.length - 1 && arr.length > 5;
          el.querySelector('.count').textContent = showCount ? String(arr.length) : '';
          el.classList.toggle('show-count', showCount);
          if (key !== 'off') el.classList.remove('slab');
          const toOff = key === 'off';
          if (!animate || el._x === undefined) {
            place(el, pos);
            el.style.zIndex = String(el._z);
            el.classList.toggle('slab', toOff);
            return;
          }
          if (moved.has(el)) {
            const delay = stagger ? order++ * stagger : mover !== null && el._p !== mover ? hitDelay : 0;
            jobs.push(flyTo(el, pos, {
              delay,
              fromDrag: el === dragged,
              onLand: (c) => { c.classList.toggle('slab', toOff); if (onLand) onLand(c); },
            }));
          } else {
            el.style.zIndex = String(el._z);
            if (el._x !== pos.x || el._y !== pos.y) jobs.push(slideTo(el, pos));
          }
        });
      }
    }
    return Promise.all(jobs);
  }

  const topChecker = (p, loc) => {
    const arr = stacks[p].get(keyOf(loc));
    return arr[arr.length - 1];
  };

  // ---------- dice ----------
  const diceEls = [];
  const PIPS = {
    1: ['2/2'], 2: ['1/1', '3/3'], 3: ['1/1', '2/2', '3/3'], 4: ['1/1', '1/3', '3/1', '3/3'],
    5: ['1/1', '1/3', '2/2', '3/1', '3/3'], 6: ['1/1', '2/1', '3/1', '1/3', '2/3', '3/3'],
  };
  const FACE_ROT = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
  const cubeTr = (v, tilt, sx = 0, sy = 0, sz = 0) => `rotateZ(${tilt + sz}deg) rotateX(${FACE_ROT[v][0] + sx}deg) rotateY(${FACE_ROT[v][1] + sy}deg)`;
  const dieTr = (x, y, s = 1) => `translate(${x - 28}px, ${y - 28}px) scale(${s})`;

  function buildDice() {
    const box = $('#dice');
    for (let i = 0; i < 4; i++) {
      const el = document.createElement('div');
      el.className = 'die';
      const faces = [1, 2, 3, 4, 5, 6].map((n) =>
        `<div class="f f${n}">${PIPS[n].map((a) => `<i style="grid-area:${a.replace('/', ' / ')}"></i>`).join('')}</div>`).join('');
      el.innerHTML = `<div class="shadow"></div><div class="scale"><div class="cube">${faces}</div></div>`;
      el._cube = el.querySelector('.cube');
      el._shown = false;
      box.appendChild(el);
      diceEls.push(el);
    }
  }

  function diceLayout(st) {
    if (st.phase === 'opening') {
      if (!st.openingRoll) return [];
      return [
        { v: st.openingRoll[0], x: G.SIDE_X[LIGHT], y: G.MID, from: LIGHT },
        { v: st.openingRoll[1], x: G.SIDE_X[DARK], y: G.MID, from: DARK },
      ];
    }
    if (!st.dice.length || st.phase === 'roll') return [];
    const [a, b] = st.dice;
    const cx = G.SIDE_X[st.turn];
    if (a === b) {
      const usedN = 4 - st.remaining.length;
      return [0, 1, 2, 3].map((i) => ({ v: a, x: cx - 108 + i * 72, y: G.MID, used: i < usedN }));
    }
    return [a, b].map((v, i) => ({ v, x: cx - 38 + i * 76, y: G.MID, used: !st.remaining.includes(v) }));
  }

  /** Pairs specs with dice already showing the same number, so a die glides instead of swapping. */
  function assignDice(specs) {
    const free = diceEls.slice();
    const out = new Array(specs.length);
    specs.forEach((s, i) => {
      const k = free.findIndex((el) => el._shown && el._v === s.v);
      if (k >= 0) out[i] = free.splice(k, 1)[0];
    });
    specs.forEach((s, i) => { if (!out[i]) out[i] = free.shift(); });
    return { pairs: specs.map((s, i) => [s, out[i]]), unused: free };
  }

  function setDie(el, s) {
    el._v = s.v; el._x = s.x; el._y = s.y;
    el.style.transform = dieTr(s.x, s.y);
    el._cube.style.transform = cubeTr(s.v, el._tilt);
    el.classList.toggle('used', !!s.used);
  }

  function hideDie(el) {
    if (!el._shown) return;
    el._shown = false;
    el.style.opacity = '0';
    el.animate([{ opacity: 1, transform: dieTr(el._x, el._y) }, { opacity: 0, transform: dieTr(el._x, el._y, 0.7) }], { duration: dur(260), easing: EASE_OUT });
  }

  /** Brings the dice on screen in line with the state, without a throw. */
  function syncDice() {
    const { pairs, unused } = assignDice(diceLayout(state));
    unused.forEach(hideDie);
    for (const [s, el] of pairs) {
      if (!el._shown) {
        el._tilt = Math.random() * 20 - 10;
        setDie(el, s);
        el._shown = true;
        el.style.opacity = '1';
        el.animate([{ opacity: 0, transform: dieTr(s.x, s.y, 0.5) }, { opacity: 1, transform: dieTr(s.x, s.y) }], { duration: dur(320), easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
      } else if (el._x !== s.x || el._y !== s.y || el._v !== s.v) {
        const from = dieTr(el._x, el._y);
        setDie(el, s);
        el.animate([{ transform: from }, { transform: dieTr(s.x, s.y) }], { duration: dur(420), easing: EASE_IN_OUT });
      } else {
        el.classList.toggle('used', !!s.used);
      }
    }
  }

  /** The throw: dice fly in from the thrower's edge, bounce and tumble to their numbers. */
  function throwDice(specs, extraFrom) {
    diceEls.forEach(hideDie);
    const jobs = [];
    const D = dur(950);
    specs.forEach((s, i) => {
      const el = diceEls[i];
      el._tilt = Math.random() * 24 - 12;
      setDie(el, s);
      el._shown = true;
      el.style.opacity = '1';
      if (s.extra) {
        // the second pair of a double appears once the first two have landed
        jobs.push(el.animate([
          { opacity: 0, transform: dieTr(s.x, s.y, 0.3) },
          { opacity: 1, transform: dieTr(s.x, s.y, 1.15), offset: 0.6 },
          { opacity: 1, transform: dieTr(s.x, s.y) },
        ], { duration: dur(380), delay: D + dur(90 * (i - 1)), easing: EASE_OUT, fill: 'backwards' }).finished.catch(() => {}));
        return;
      }
      const from = s.from !== undefined ? s.from : extraFrom;
      const dir = from === LIGHT ? -1 : 1; // light throws upward from the bottom edge
      const sx = s.x + (Math.random() * 140 - 70);
      const sy = from === LIGHT ? G.BOTTOM + 30 : G.TOP - 30;
      const ox = s.x + (Math.random() * 30 - 15);
      const oy = s.y + dir * 34;
      jobs.push(el.animate([
        { opacity: 0, transform: dieTr(sx, sy, 0.8) },
        { opacity: 1, transform: dieTr((sx + s.x) / 2, (sy + s.y) / 2, 1.35), offset: 0.3 },
        { transform: dieTr(ox, oy, 1), offset: 0.58 },
        { transform: dieTr(s.x, s.y - dir * 6, 1.1), offset: 0.76 },
        { transform: dieTr(s.x, s.y, 1) },
      ], { duration: D, easing: 'cubic-bezier(0.25, 0.6, 0.3, 1)' }).finished.catch(() => {}));
      const spinX = -(720 + Math.floor(Math.random() * 3) * 90);
      const spinY = -(540 + Math.floor(Math.random() * 3) * 90);
      const spinZ = Math.random() < 0.5 ? -270 : 270;
      el._cube.animate([
        { transform: cubeTr(s.v, el._tilt, spinX, spinY, spinZ) },
        { transform: cubeTr(s.v, el._tilt) },
      ], { duration: D, easing: 'cubic-bezier(0.15, 0.55, 0.25, 1)' });
    });
    Sound.rattle(D * 0.6);
    setTimeout(() => Sound.land(), D * 0.58);
    return Promise.all(jobs);
  }

  function randomDie() {
    const buf = new Uint8Array(1);
    for (;;) {
      crypto.getRandomValues(buf);
      if (buf[0] < 252) return (buf[0] % 6) + 1; // 252 = 6 * 42: no bias
    }
  }

  // ---------- interface updates ----------
  const cards = [$('#card0'), $('#card1')];
  let shownScore = [null, null];

  function updateCards() {
    for (const p of [LIGHT, DARK]) {
      const c = cards[p];
      c.querySelector('.name').textContent = state.players[p].name;
      c.querySelector('.pips').textContent = 'остават ' + E.pipCount(state.board, p);
      c.querySelector('.offbar i').style.transform = `scaleX(${state.board.off[p] / E.CHECKERS})`;
      const b = c.querySelector('.score b');
      if (shownScore[p] !== state.score[p]) {
        b.textContent = String(state.score[p]);
        if (shownScore[p] !== null && state.score[p] > shownScore[p]) {
          b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
        }
        shownScore[p] = state.score[p];
      }
      const active = (state.phase === 'roll' || state.phase === 'move') && state.turn === p;
      c.classList.toggle('active', active);
    }
    $('#matchInfo').textContent = (state.matchTo ? `Мач до ${state.matchTo} · ` : '') + `игра ${state.gameNo + 1}`;
  }

  function updateLabels() {
    const view = state.phase === 'opening' ? LIGHT : state.turn;
    for (let i = 0; i < 24; i++) document.getElementById('lbl' + i).textContent = E.pipOf(view, i);
  }

  const turnDone = () => state.phase === 'move' && (!state.remaining.length || !movesNow.length);

  function plural(n) { return n === 1 ? 'ход' : 'хода'; }

  function updateControls() {
    const name = state.players[state.turn].name;
    let label = 'Готово';
    let enabled = false;
    let pulse = false;
    let status = '';
    switch (state.phase) {
      case 'opening':
        label = state.openingRoll ? 'Хвърли пак' : 'Хвърли за начало';
        enabled = pulse = true;
        status = state.openingRoll ? 'Равни зарове — хвърлете отново' : 'Всеки хвърля по един зар — по-високият започва';
        break;
      case 'roll':
        label = 'Хвърли';
        enabled = pulse = true;
        status = `${name} е на ход`;
        break;
      case 'move':
        enabled = turnDone();
        pulse = enabled;
        if (!movesNow.length && state.remaining.length) status = `${name}: няма възможен ход`;
        else if (!state.remaining.length) status = `${name}: натисни „Готово“`;
        else {
          const r = state.remaining;
          status = r.length > 2 ? `${name}: ${r.length} ${plural(r.length)} по ${r[0]}` : `${name} играе ${r.join(' и ')}`;
        }
        break;
      case 'gameover':
        label = 'Следваща игра'; enabled = true;
        break;
      case 'matchover':
        label = 'Реванш'; enabled = true;
        break;
    }
    const btn = $('#mainBtn');
    const span = btn.querySelector('span');
    if (span.textContent !== label) {
      span.textContent = label;
      span.classList.remove('swap'); void span.offsetWidth; span.classList.add('swap');
    }
    btn.disabled = busy || !enabled;
    btn.classList.toggle('pulse', pulse);
    $('#undoBtn').disabled = busy || !history.length;
    $('#status').textContent = status;
  }

  function updateHighlights() {
    document.querySelectorAll('.checker.movable, .checker.selected').forEach((el) => el.classList.remove('movable', 'selected'));
    document.querySelectorAll('.hl.on').forEach((el) => el.classList.remove('on', 'hover'));
    document.querySelectorAll('.spot').forEach((el) => el.remove());
    if (busy || state.phase !== 'move') return;
    for (const src of sources) {
      const el = topChecker(state.turn, src);
      if (el) el.classList.add(selected && selected.from === src ? 'selected' : 'movable');
    }
    if (selected) {
      for (const k of selected.dests.keys()) {
        const loc = k === OFF ? OFF : +k;
        const h = hlFor(loc);
        if (h) h.classList.add('on');
        addSpot(loc);
      }
    }
  }

  /** A dashed ring exactly where the selected checker would land. */
  function addSpot(loc) {
    const p = state.turn;
    const key = keyOf(loc);
    const arr = stacks[p].get(key);
    const pos = slot(p, key, arr.length, arr.length + 1);
    const d = document.createElement('div');
    d.className = 'spot' + (loc === OFF ? ' tray' : '');
    d.dataset.loc = String(loc);
    d.style.left = pos.x - R + 'px';
    d.style.top = pos.y - (loc === OFF ? 10 : R) + 'px';
    $('#hls').appendChild(d);
  }

  function updateRollHint() {
    const h = $('#rollHint');
    const show = !busy && (state.phase === 'roll' || (state.phase === 'opening' && !state.openingRoll));
    if (show) {
      const x = state.phase === 'opening' ? (G.RIGHT_L + G.RIGHT_R) / 2 : G.SIDE_X[state.turn];
      h.style.left = x + 'px';
      h.style.top = G.MID + 'px';
    }
    h.classList.toggle('show', show);
  }

  function refresh() {
    movesNow = E.currentMoves(state);
    sources = new Set(movesNow.map((m) => m.from));
    if (selected && !sources.has(selected.from)) selected = null;
    updateCards();
    updateLabels();
    updateControls();
    updateHighlights();
    updateRollHint();
    save();
  }

  // ---------- messages ----------
  function banner(text, ms = 1300) {
    const b = $('#banner');
    b.textContent = text;
    b.getAnimations().forEach((a) => a.cancel());
    b.animate([
      { opacity: 0, transform: 'translate(-50%, -50%) scale(0.85)' },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.18 },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.8 },
      { opacity: 0, transform: 'translate(-50%, -50%) scale(1.04)' },
    ], { duration: reduced.matches ? ms : ms, easing: EASE_OUT });
  }

  let toastTimer = 0;
  function toast(text, ms = 1800) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------- actions ----------
  function pushHistory() {
    history.push(state);
    if (history.length > 600) history.shift();
  }

  async function run(fn) {
    if (busy) return;
    busy = true;
    selected = null;
    refresh();
    try { await fn(); } finally { busy = false; refresh(); }
  }

  function actRoll() {
    if (state.phase === 'opening') return run(openingThrow);
    if (state.phase !== 'roll') return;
    return run(async () => {
      pushHistory();
      const key = `${state.gameNo}:${state.turnSeq}`;
      const pair = rollLog[key] || (rollLog[key] = [randomDie(), randomDie()]);
      state = E.roll(state, pair[0], pair[1]);
      const layout = diceLayout(state);
      const specs = layout.map((s, i) => ({ ...s, used: false, extra: i >= 2 }));
      await throwDice(specs, state.turn);
      syncDice();
      afterRoll();
    });
  }

  async function openingThrow() {
    const key = `${state.gameNo}:0`;
    const pair = rollLog[key] || [randomDie(), randomDie()];
    const before = state;
    state = E.openingRoll(state, pair[0], pair[1]);
    await throwDice([
      { v: pair[0], x: G.SIDE_X[LIGHT], y: G.MID, from: LIGHT },
      { v: pair[1], x: G.SIDE_X[DARK], y: G.MID, from: DARK },
    ]);
    if (state.phase === 'opening') {
      toast('Равни зарове — хвърлете отново');
      return;
    }
    rollLog[key] = pair;
    history.push(before);
    await wait(350);
    banner(`${state.players[state.turn].name} започва`);
    await wait(900);
    syncDice();
    await wait(300);
    afterRoll();
  }

  function afterRoll() {
    movesNow = E.currentMoves(state);
    if (!movesNow.length) {
      toast('Няма възможен ход');
      Sound.error();
      scheduleAutoDone(1500);
    }
  }

  let autoTimer = 0;
  function scheduleAutoDone(ms) {
    clearTimeout(autoTimer);
    if (!settings.autoDone) return;
    const at = state;
    autoTimer = setTimeout(() => { if (state === at && !busy) actDone(); }, ms);
  }

  function actMove(path, dragged = null) {
    return run(async () => {
      pushHistory();
      const mover = state.turn;
      for (let k = 0; k < path.length; k++) {
        const m = path[k];
        state = E.play(state, m);
        syncDice();
        if (m.hit) setTimeout(() => Sound.hit(), dur(330));
        await reconcile(state.board, {
          mover,
          hitDelay: 330,
          dragged: k === 0 ? dragged : null,
          onLand: (el) => { if (el._p === mover) (m.to === OFF ? Sound.off() : Sound.checker()); },
        });
        updateCards();
      }
      if (state.phase === 'gameover' || state.phase === 'matchover') {
        await wait(400);
        showOver();
        return;
      }
      movesNow = E.currentMoves(state);
      if (!state.remaining.length || !movesNow.length) scheduleAutoDone(650);
    });
  }

  function actDone() {
    if (busy || !turnDone()) return;
    clearTimeout(autoTimer);
    pushHistory();
    state = E.endTurn(state);
    Sound.tap();
    syncDice();
    refresh();
    banner(`Ред е на ${state.players[state.turn].name}`, 1100);
  }

  function actUndo() {
    if (!history.length) return;
    clearTimeout(autoTimer);
    hideOverlay('#over');
    return run(async () => {
      state = history.pop();
      Sound.tap();
      syncDice();
      await reconcile(state.board);
    });
  }

  function actMain() {
    if (state.phase === 'opening' || state.phase === 'roll') actRoll();
    else if (state.phase === 'move') actDone();
    else if (state.phase === 'gameover') nextGame();
    else if (state.phase === 'matchover') rematch();
  }

  function nextGame() {
    hideOverlay('#over');
    state = E.nextGame(state);
    freshGameView(`Игра ${state.gameNo + 1}`);
  }

  function rematch() {
    hideOverlay('#over');
    state = E.newMatch(state.players.map((p) => p.name), state.matchTo);
    freshGameView('Реванш!');
  }

  function freshGameView(text) {
    history = [];
    rollLog = {};
    selected = null;
    return run(async () => {
      syncDice();
      await reconcile(state.board, { stagger: 28 });
      banner(text);
    });
  }

  function restartGame() {
    const gameNo = state.gameNo;
    state = { ...E.nextGame(state), gameNo };
    freshGameView('Отначало');
  }

  // ---------- game over ----------
  function showOver() {
    const r = state.result;
    const before = history[history.length - 1];
    const prev = before ? before.score : state.score;
    const name = state.players[r.winner].name;
    const matchOver = state.phase === 'matchover';
    $('#overTitle').textContent = matchOver ? `${name} печели мача!` : `${name} печели!`;
    $('#overKind').textContent = { single: 'Победа · +1', gammon: 'Марс! · +2', backgammon: 'Бекгамон! · +3' }[r.kind];
    for (const p of [LIGHT, DARK]) {
      $('#overName' + p).textContent = state.players[p].name;
      $('#overScore' + p).textContent = String(prev[p]);
    }
    $('#overTarget').textContent = state.matchTo ? `Мач до ${state.matchTo}` : 'Свободна игра';
    $('#overNext').textContent = matchOver ? 'Реванш' : 'Следваща игра';
    $('#overNew').hidden = !matchOver;
    showOverlay('#over');
    Sound.win(matchOver);
    confetti(matchOver ? 260 : 110);
    setTimeout(() => {
      const b = $('#overScore' + r.winner);
      b.textContent = String(state.score[r.winner]);
      b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
    }, dur(650));
  }

  function confetti(count) {
    if (reduced.matches) return;
    const cv = $('#confetti');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    const colors = ['#ffd88a', '#e7b85c', '#f3ead8', '#b85a3c', '#2c5443', '#fffaf0'];
    const parts = Array.from({ length: count }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 120,
      y: innerHeight * 0.42,
      vx: (Math.random() - 0.5) * 16,
      vy: -Math.random() * 16 - 6,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      w: 6 + Math.random() * 7, h: 4 + Math.random() * 5,
      c: colors[(Math.random() * colors.length) | 0],
    }));
    const start = performance.now();
    function frame(t) {
      const life = (t - start) / 3200;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const q of parts) {
        q.vy += 0.38; q.vx *= 0.99; q.x += q.vx; q.y += q.vy; q.r += q.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - life);
        ctx.translate(q.x, q.y); ctx.rotate(q.r);
        ctx.fillStyle = q.c;
        ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h * Math.abs(Math.cos(q.r * 2)));
        ctx.restore();
      }
      if (life < 1) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    }
    requestAnimationFrame(frame);
  }

  // ---------- overlays ----------
  function showOverlay(sel) {
    const o = $(sel);
    o.classList.add('show');
    $('#app').setAttribute('aria-hidden', 'true');
    const f = o.querySelector('.btn.primary, input, .btn');
    if (f) setTimeout(() => f.focus({ preventScroll: true }), 50);
  }
  function hideOverlay(sel) {
    $(sel).classList.remove('show');
    if (!document.querySelector('.overlay.show')) $('#app').removeAttribute('aria-hidden');
  }
  const anyOverlay = () => !!document.querySelector('.overlay.show');

  // ---------- pointer input ----------
  function toBoard(e) {
    const r = $('#board').getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }

  function select(from) {
    selected = { from, dests: E.destinations(state.board, state.turn, state.remaining, from) };
    Sound.tap();
    updateHighlights();
  }

  function clearSelection() {
    if (!selected) return;
    selected = null;
    updateHighlights();
  }

  function onPointerDown(e) {
    if (busy || anyOverlay() || e.button > 0) return;
    const { x, y } = toBoard(e);
    if (state.phase === 'roll' || state.phase === 'opening') { actRoll(); return; }
    if (state.phase !== 'move') return;
    const loc = locAt(x, y);
    if (selected && loc !== null && selected.dests.has(String(loc))) {
      actMove(selected.dests.get(String(loc)));
      return;
    }
    if (loc !== null && sources.has(loc)) {
      const wasSelected = selected && selected.from === loc;
      if (!wasSelected) select(loc);
      const el = topChecker(state.turn, loc);
      drag = { id: e.pointerId, sx: x, sy: y, el, loc, dragging: false, wasSelected, hover: null };
      $('#board').setPointerCapture(e.pointerId);
      return;
    }
    if (selected) {
      Sound.error();
      clearSelection();
    }
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { x, y } = toBoard(e);
    if (!drag.dragging) {
      if (Math.hypot(x - drag.sx, y - drag.sy) < 8) return;
      drag.dragging = true;
      drag.el.classList.add('dragging', 'lifted');
      drag.el.style.zIndex = '800';
    }
    place(drag.el, { x, y });
    const loc = locAt(x, y);
    const h = loc !== null && selected && selected.dests.has(String(loc)) ? hlFor(loc) : null;
    if (h !== drag.hover) {
      if (drag.hover) drag.hover.classList.remove('hover');
      document.querySelectorAll('.spot.hover').forEach((el) => el.classList.remove('hover'));
      if (h) {
        h.classList.add('hover');
        const spot = document.querySelector(`.spot[data-loc="${loc}"]`);
        if (spot) spot.classList.add('hover');
      }
      drag.hover = h;
    }
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.hover) d.hover.classList.remove('hover');
    if (!d.dragging) {
      if (d.wasSelected) clearSelection();
      return;
    }
    const { x, y } = toBoard(e);
    const loc = locAt(x, y);
    if (selected && loc !== null && selected.dests.has(String(loc))) {
      actMove(selected.dests.get(String(loc)), d.el);
      return;
    }
    // dropped somewhere illegal: back home
    const arr = stacks[state.turn].get(keyOf(d.loc));
    const pos = slot(state.turn, keyOf(d.loc), arr.length - 1, arr.length);
    flyTo(d.el, pos, { fromDrag: true });
    if (loc !== d.loc) Sound.error();
  }

  function onDoubleClick(e) {
    if (busy || state.phase !== 'move') return;
    const { x, y } = toBoard(e);
    const loc = locAt(x, y);
    if (loc === null || !sources.has(loc)) return;
    const dests = E.destinations(state.board, state.turn, state.remaining, loc);
    let best = null;
    for (const path of dests.values()) {
      if (path.length !== 1) continue;
      if (!best || path[0].die > best[0].die) best = path;
    }
    if (best) actMove(best);
  }

  // ---------- keyboard ----------
  function onKey(e) {
    if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') return;
    if (e.key === 'Escape') {
      if ($('#rules').classList.contains('show')) hideOverlay('#rules');
      else if ($('#menu').classList.contains('show')) hideOverlay('#menu');
      else clearSelection();
      return;
    }
    if (anyOverlay()) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); actUndo(); return; }
    if (e.key === ' ' || e.key === 'Enter') {
      if (document.activeElement && document.activeElement.tagName === 'BUTTON') return;
      e.preventDefault();
      if (state.phase === 'opening' || state.phase === 'roll' || turnDone()) actMain();
    }
  }

  // ---------- sizing ----------
  function fit() {
    const r = $('#boardWrap').getBoundingClientRect();
    scale = Math.max(0.1, Math.min(r.width / G.W, r.height / G.H));
    const box = $('#boardBox');
    box.style.width = G.W * scale + 'px';
    box.style.height = G.H * scale + 'px';
    $('#board').style.transform = `scale(${scale})`;
  }

  // ---------- saving ----------
  function save() {
    if (!started) return;
    try {
      localStorage.setItem(STORE, JSON.stringify({ state, history: history.slice(-200), rollLog, settings, matchLength }));
    } catch (_) { /* private mode or file:// without storage: the game still works */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  // ---------- setup ----------
  function startMatch(names, length) {
    state = E.newMatch(names, length);
    started = true;
    shownScore = [null, null];
    hideOverlay('#setup');
    freshGameView('Започваме!');
  }

  function resume(saved) {
    state = saved.state;
    history = saved.history || [];
    rollLog = saved.rollLog || {};
    started = true;
    shownScore = [null, null];
    hideOverlay('#setup');
    run(async () => {
      syncDice();
      await reconcile(state.board, { stagger: 20 });
    }).then(() => {
      if (state.phase === 'gameover' || state.phase === 'matchover') showOver();
    });
  }

  function bindSetup(saved) {
    const chips = document.querySelectorAll('#lengthChips button');
    const pick = (v) => {
      matchLength = v;
      chips.forEach((c) => c.classList.toggle('on', +c.dataset.v === v));
    };
    chips.forEach((c) => c.addEventListener('click', () => { pick(+c.dataset.v); Sound.tap(); }));
    pick(saved && saved.matchLength !== undefined ? saved.matchLength : 5);
    if (saved && saved.state) {
      $('#name0').value = saved.state.players[0].name;
      $('#name1').value = saved.state.players[1].name;
      if (saved.state.phase !== 'matchover') {
        $('#resumeBtn').hidden = false;
        $('#resumeBtn').addEventListener('click', () => resume(saved), { once: true });
      }
    }
    $('#setupForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const n0 = $('#name0').value.trim() || $('#name0').placeholder;
      let n1 = $('#name1').value.trim() || $('#name1').placeholder;
      if (n1 === n0) n1 += ' 2';
      $('#resumeBtn').hidden = true;
      startMatch([n0, n1], matchLength);
    });
  }

  function bindMenu() {
    $('#menuBtn').addEventListener('click', () => {
      if (busy) return;
      document.querySelectorAll('#menu .armed').forEach((b) => { b.classList.remove('armed'); b.textContent = b.dataset.label; });
      showOverlay('#menu');
    });
    const sound = $('#optSound');
    const auto = $('#optAuto');
    sound.checked = settings.sound;
    auto.checked = settings.autoDone;
    sound.addEventListener('change', () => { settings.sound = Sound.enabled = sound.checked; Sound.tap(); save(); });
    auto.addEventListener('change', () => { settings.autoDone = auto.checked; save(); if (turnDone()) scheduleAutoDone(400); });
    document.querySelectorAll('[data-act]').forEach((b) => {
      if (b.dataset.confirm) b.dataset.label = b.textContent;
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (b.dataset.confirm && !b.classList.contains('armed')) {
          b.classList.add('armed');
          b.textContent = b.dataset.confirm;
          return;
        }
        if (b.dataset.confirm) { b.classList.remove('armed'); b.textContent = b.dataset.label; }
        if (act === 'close') { hideOverlay('#' + b.closest('.overlay').id); }
        else if (act === 'rules') { hideOverlay('#menu'); showOverlay('#rules'); }
        else if (act === 'restart') { hideOverlay('#menu'); restartGame(); }
        else if (act === 'newmatch') {
          hideOverlay('#menu'); hideOverlay('#over');
          $('#resumeBtn').hidden = true;
          showOverlay('#setup');
        }
        else if (act === 'undo') actUndo();
        else if (act === 'next') actMain();
      });
    });
    document.querySelectorAll('.overlay').forEach((o) => {
      o.addEventListener('pointerdown', (e) => {
        if (e.target === o && (o.id === 'menu' || o.id === 'rules')) hideOverlay('#' + o.id);
      });
    });
  }

  // ---------- boot ----------
  function boot() {
    buildBoardArt();
    buildHighlights();
    buildCheckers();
    buildDice();
    const saved = load();
    if (saved && saved.settings) settings = { ...settings, ...saved.settings };
    Sound.enabled = settings.sound;
    state = E.newMatch(['Играч 1', 'Играч 2'], 5);
    state = { ...state, board: { points: new Array(24).fill(0), bar: [0, 0], off: [15, 15] } };
    reconcile(state.board, { animate: false });
    fit();
    new ResizeObserver(fit).observe($('#boardWrap'));
    refresh();
    bindSetup(saved);
    bindMenu();
    const board = $('#board');
    board.addEventListener('pointerdown', onPointerDown);
    board.addEventListener('pointermove', onPointerMove);
    board.addEventListener('pointerup', onPointerUp);
    board.addEventListener('pointercancel', onPointerUp);
    board.addEventListener('dblclick', onDoubleClick);
    $('#mainBtn').addEventListener('click', actMain);
    $('#undoBtn').addEventListener('click', actUndo);
    document.addEventListener('keydown', onKey);
    setTimeout(() => $('#name0').focus({ preventScroll: true }), 300);
    // for automated checks only
    window.__tabla = { get state() { return state; }, get busy() { return busy; }, actMove, actRoll, actDone, actUndo, E };
  }

  boot();
})();
