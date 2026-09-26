/* Screen, input and animation. The rules live in engine.js; this file only
 * asks the engine what is legal and shows it. */
(function () {
  'use strict';
  const E = window.TablaEngine;
  const Sound = window.TablaSound;
  const { LIGHT, DARK, BAR, OFF } = E;

  const $ = (s) => document.querySelector(s);
  // Full animations by default, even when the phone asks for less motion: the
  // players chose that (an iPhone with Reduce Motion on used to see none at
  // all). "Намалени анимации" in the menu makes every movement short and calm.
  const reduced = { get matches() { return !!settings.calm; } };
  const dur = (ms) => (reduced.matches ? Math.round(ms * 0.45) : ms);
  const wait = (ms) => new Promise((r) => setTimeout(r, dur(ms)));
  const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  const EASE_IN_OUT = 'cubic-bezier(0.45, 0, 0.25, 1)';
  const STORE = 'tabla.v1';

  // ---------- geometry (board units; the board is scaled to fit) ----------
  const G = {
    W: 1000, H: 780, TOP: 25, BOTTOM: 755, MID: 390, PW: 65, PH: 300, D: 58,
    BAR_L: 415, BAR_R: 475, BAR_X: 445, TRAY_L: 890, TRAY_R: 975, TRAY_X: 932.5,
    LEFT_L: 25, RIGHT_L: 475, RIGHT_R: 865,
  };
  // The player sitting at the bottom of the screen: light when two share one
  // device, and online each player sees their own checkers at the bottom. The
  // other view is the board mirrored top to bottom, so point i is drawn where
  // point 23 - i would be.
  let view = LIGHT;
  const disp = (i) => (view === LIGHT ? i : 23 - i);
  const atBottom = (p) => p === view;
  /** Where a player's dice land: the bottom player's on the right half. */
  const sideX = (p) => (atBottom(p) ? 670 : 220);
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
      return { x: G.TRAY_X, y: atBottom(p) ? G.BOTTOM - 12 - i * 19 : G.TOP + 12 + i * 19 };
    }
    if (key === 'bar') {
      const sp = n <= 1 ? G.D : Math.min(G.D, (G.PH - 30 - G.D) / (n - 1));
      return { x: G.BAR_X, y: atBottom(p) ? G.MID + 36 + R + i * sp : G.MID - 36 - R - i * sp };
    }
    const idx = disp(+key.slice(1));
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
      return disp(top ? 12 + c : 11 - c);
    }
    if (x >= G.RIGHT_L && x < G.RIGHT_R) {
      const c = Math.floor((x - G.RIGHT_L) / G.PW);
      return disp(top ? 18 + c : 5 - c);
    }
    return null;
  }
  const keyOf = (loc) => (typeof loc === 'number' ? 'p' + loc : loc);

  // ---------- state ----------
  let state = null;
  let history = [];
  let rollLog = {}; // dice already thrown for a turn: undo never re-rolls
  let settings = { sound: true, autoDone: false, calm: false };
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
      d.dataset.key = String(i);
      box.appendChild(d);
    }
    for (const p of [LIGHT, DARK]) {
      const d = document.createElement('div');
      d.className = 'hl tray';
      d.dataset.key = 'off' + p;
      box.appendChild(d);
    }
    layoutHighlights();
  }

  function layoutHighlights() {
    for (let i = 0; i < 24; i++) {
      const d = document.querySelector(`#hls > div[data-key="${i}"]`);
      const at = disp(i);
      d.className = 'hl pt ' + (isTop(at) ? 'top' : 'bottom');
      d.style.left = pointX(at) - G.PW / 2 + 'px';
      d.style.top = (isTop(at) ? G.TOP : G.BOTTOM - G.PH) + 'px';
    }
    for (const p of [LIGHT, DARK]) {
      document.querySelector(`.hl[data-key="off${p}"]`).style.top = (atBottom(p) ? G.MID : G.TOP) + 'px';
    }
  }

  /** Turns the board so that `p` sits at the bottom. */
  function setView(p) {
    if (p === view) return;
    view = p;
    layoutHighlights();
    for (const [el, i] of [[$('#card0'), view], [$('#card1'), 1 - view]]) {
      el.dataset.p = String(i);
      el.querySelector('.token').className = 'token ' + (i === LIGHT ? 'light' : 'dark');
    }
    reconcile(state.board, { animate: false });
    syncDice();
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
        { v: st.openingRoll[0], x: sideX(LIGHT), y: G.MID, from: LIGHT },
        { v: st.openingRoll[1], x: sideX(DARK), y: G.MID, from: DARK },
      ];
    }
    if (!st.dice.length || st.phase === 'roll') return [];
    const [a, b] = st.dice;
    const cx = sideX(st.turn);
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
      const dir = atBottom(from) ? -1 : 1; // the bottom player throws upward
      const sx = s.x + (Math.random() * 140 - 70);
      const sy = atBottom(from) ? G.BOTTOM + 30 : G.TOP - 30;
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

  // ---------- online ----------
  const Net = window.TablaNet;
  const online = {
    role: null, // null: both players on this screen; 'host' or 'guest' online
    seat: null, // which colour this screen plays online
    id: null, // the host's peer id, which is also the invite
    link: null,
    myName: '',
    peerName: '',
    connected: false,
    awaiting: false, // the guest asked the host for something and waits for the answer
    note: '',
    left: false, // the other player pressed "Напусни", rather than just losing the connection
    busy: false, // the guest was turned away: someone else holds the seat
    guestToken: '', // the guest's secret; the host keeps the one it let in
    fairWarnings: 0,
  };
  let awaitTimer = 0;
  let remoteDrag = null; // the checker the other player is dragging right now
  let remoteSel = null; // the checker the other player has picked up
  let localDropped = null; // our checker, dropped on a target, waiting for the move to be played
  let dragSentAt = 0;

  const myTurn = () => !online.role || state.turn === online.seat;
  const send = (msg) => online.link && online.link.send(msg);

  // ---------- interface updates ----------
  const cardOf = (p) => (atBottom(p) ? $('#card0') : $('#card1'));

  function updateCards() {
    for (const p of [LIGHT, DARK]) {
      const c = cardOf(p);
      c.querySelector('.name').textContent = state.players[p].name;
      const away = online.role && p !== online.seat && !online.connected;
      c.querySelector('.pips').textContent = 'остават ' + E.pipCount(state.board, p) + (away ? ' · няма връзка' : '');
      c.classList.toggle('away', !!away);
      c.querySelector('.offbar i').style.transform = `scaleX(${state.board.off[p] / E.CHECKERS})`;
      const b = c.querySelector('.score b');
      if (b._p !== p || b._score !== state.score[p]) {
        const grew = b._p === p && b._score !== undefined && state.score[p] > b._score;
        b.textContent = String(state.score[p]);
        if (grew) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
        b._p = p;
        b._score = state.score[p];
      }
      const active = (state.phase === 'roll' || state.phase === 'move') && state.turn === p;
      c.classList.toggle('active', active);
    }
    $('#matchInfo').textContent = (state.matchTo ? `Мач до ${state.matchTo} · ` : '') + `игра ${state.gameNo + 1}`;
  }

  function updateLabels() {
    const pv = online.role ? online.seat : state.phase === 'opening' ? LIGHT : state.turn;
    for (let d = 0; d < 24; d++) document.getElementById('lbl' + d).textContent = E.pipOf(pv, disp(d));
  }

  const turnDone = () => state.phase === 'move' && (!state.remaining.length || !movesNow.length);

  function plural(n) { return n === 1 ? 'ход' : 'хода'; }

  function movesThisTurn(st) {
    if (st.phase !== 'move' || !st.dice.length) return 0;
    return (st.dice[0] === st.dice[1] ? 4 : 2) - st.remaining.length;
  }

  function canUndo() {
    if (busy || online.awaiting) return false;
    if (!online.role) return history.length > 0;
    return myTurn() && movesThisTurn(state) > 0;
  }

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
        if (myTurn()) {
          label = 'Хвърли';
          enabled = pulse = true;
          status = online.role ? 'Твой ред е' : `${name} е на ход`;
        } else {
          label = `Ред е на ${name}`;
          status = `Чакаме ${name}…`;
        }
        break;
      case 'move':
        if (!myTurn()) {
          status = `${name} играе…`;
          break;
        }
        enabled = turnDone();
        pulse = enabled;
        if (!movesNow.length && state.remaining.length) status = `${online.role ? 'Нямаш' : name + ': няма'} възможен ход`;
        else if (!state.remaining.length) status = 'Натисни „Готово“';
        else {
          const r = state.remaining;
          const who = online.role ? 'Играеш' : `${name} играе`;
          status = r.length > 2 ? `${who} ${r.length} ${plural(r.length)} по ${r[0]}` : `${who} ${r.join(' и ')}`;
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
    btn.disabled = busy || online.awaiting || !enabled;
    btn.classList.toggle('pulse', pulse);
    $('#undoBtn').disabled = !canUndo();
    $('#status').textContent = status;
    const ns = $('#netStatus');
    ns.hidden = !online.role;
    ns.textContent = online.note;
    ns.classList.toggle('ok', online.connected);
  }

  function updateHighlights() {
    document.querySelectorAll('.checker.movable, .checker.selected').forEach((el) => el.classList.remove('movable', 'selected'));
    document.querySelectorAll('.hl.on').forEach((el) => el.classList.remove('on', 'hover'));
    document.querySelectorAll('.spot').forEach((el) => el.remove());
    if (busy || state.phase !== 'move') return;
    if (!myTurn()) {
      const el = remoteSel !== null && topChecker(state.turn, remoteSel);
      if (el) el.classList.add('selected');
      return;
    }
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
    const show = !busy && ((state.phase === 'roll' && myTurn()) || (state.phase === 'opening' && !state.openingRoll));
    if (show) {
      const x = state.phase === 'opening' ? (G.RIGHT_L + G.RIGHT_R) / 2 : sideX(state.turn);
      h.style.left = x + 'px';
      h.style.top = G.MID + 'px';
    }
    h.classList.toggle('show', show);
  }

  function refresh() {
    movesNow = E.currentMoves(state);
    sources = new Set(movesNow.map((m) => m.from));
    if (selected && (!sources.has(selected.from) || !myTurn())) selected = null;
    updateCards();
    updateLabels();
    updateControls();
    updateHighlights();
    updateRollHint();
    updateSocial();
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
    ], { duration: ms, easing: EASE_OUT });
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
  // Every change to the game is an action: {k: 'opening' | 'roll' | 'move' |
  // 'done' | 'undo' | 'next' | 'rematch' | 'restart' | 'start'}. The referee
  // (this screen, or the host online) decides its outcome in commit(); both
  // screens then show it with present(). Actions run one after another.

  let chain = Promise.resolve();
  function enqueue(fn) {
    chain = chain.then(async () => {
      busy = true;
      selected = null;
      refresh();
      try { await fn(); } catch (e) { console.error(e); } finally { busy = false; refresh(); }
    });
    return chain;
  }

  function pushHistory(st) {
    history.push(st);
    if (history.length > 600) history.shift();
  }

  /** Legal moves exactly as the engine would make them, or null. */
  function checkedPath(st, path) {
    if (!Array.isArray(path) || !path.length || path.length > 4) return null;
    const out = [];
    let s = st;
    for (let i = 0; i < path.length; i++) {
      if (s.phase !== 'move') return null;
      const m = path[i] || {};
      const legal = E.currentMoves(s).find((x) => x.from === m.from && x.to === m.to && x.die === m.die);
      if (!legal) return null;
      out.push(legal);
      s = E.play(s, legal);
    }
    return out;
  }

  /** May the player in `seat` do this now? seat null: both share this screen. */
  function allowed(a, seat) {
    const st = state;
    const own = seat === null || st.turn === seat;
    switch (a && a.k) {
      case 'opening': return st.phase === 'opening';
      case 'roll': return own && st.phase === 'roll';
      case 'move': return own && st.phase === 'move' && !!checkedPath(st, a.path);
      case 'done': return own && st.phase === 'move' && (!st.remaining.length || !E.currentMoves(st).length);
      // only the referee keeps the history; the guest just asks
      case 'undo': return (online.role === 'guest' || history.length > 0) && (seat === null || (own && movesThisTurn(st) > 0));
      case 'next': return st.phase === 'gameover';
      case 'rematch': return st.phase === 'matchover';
      case 'restart': return seat === null || seat === LIGHT;
      case 'rename': return typeof a.name === 'string' && (a.seat === LIGHT || a.seat === DARK) && (seat === null || a.seat === seat);
      default: return false;
    }
  }

  /**
   * The numbers for a throw. Online both browsers take part (fair.js); on one
   * screen this browser rolls. A throw already made for this turn is reused,
   * so undo never re-rolls. null: the friend's half is missing (no connection).
   */
  async function diceFor(key) {
    if (rollLog[key]) return { dice: rollLog[key] };
    if (online.role === 'host') return fairThrow();
    return { dice: [randomDie(), randomDie()] };
  }

  const cleanName = (x, fallback) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim().slice(0, 16) || fallback;

  /** The referee: settles the dice, records the step for undo and shows it. Runs inside the queue. */
  async function commit(a) {
    const prev = state;
    let next;
    let act = { k: a.k };
    switch (a.k) {
      case 'opening': case 'roll': {
        const key = a.k === 'opening' ? `${prev.gameNo}:0` : `${prev.gameNo}:${prev.turnSeq}`;
        const thrown = await diceFor(key);
        if (!thrown) {
          toast(`Няма връзка с ${online.peerName || 'приятеля'} — хвърли пак, щом се свърже`, 2600);
          return undefined;
        }
        const dice = thrown.dice;
        if (a.k === 'opening') {
          next = E.openingRoll(prev, dice[0], dice[1]);
          if (next.phase !== 'opening') { rollLog[key] = dice; pushHistory(prev); }
        } else {
          rollLog[key] = dice;
          pushHistory(prev);
          next = E.roll(prev, dice[0], dice[1]);
        }
        act.dice = dice;
        if (thrown.fair) act.fair = thrown.fair;
        break;
      }
      case 'rename': {
        const name = cleanName(a.name, prev.players[a.seat].name);
        next = { ...prev, players: prev.players.map((p, i) => (i === a.seat ? { name } : p)) };
        act = { k: 'rename', seat: a.seat, name };
        break;
      }
      case 'move': {
        const path = checkedPath(prev, a.path);
        pushHistory(prev);
        next = path.reduce((s, m) => E.play(s, m), prev);
        act.path = path;
        break;
      }
      case 'done':
        pushHistory(prev);
        next = E.endTurn(prev);
        break;
      case 'undo':
        next = { ...history.pop(), players: prev.players }; // a new name survives undo
        break;
      case 'next':
        next = E.nextGame(prev);
        break;
      case 'rematch':
        next = E.newMatch(prev.players.map((p) => p.name), prev.matchTo);
        break;
      case 'restart':
        next = { ...E.nextGame(prev), gameNo: prev.gameNo };
        break;
    }
    if (a.k === 'next' || a.k === 'rematch' || a.k === 'restart') {
      history = [];
      rollLog = {};
    }
    if (online.role === 'host') send({ t: 'act', a: act, state: next });
    return present(prev, act, next);
  }

  /** What the player on this screen asks for. */
  function request(a) {
    if (busy || online.awaiting) return;
    if (online.role === 'guest') {
      if (!online.connected) { toast('Няма връзка с приятеля'); return; }
      if (!allowed(a, online.seat)) return;
      send({ t: 'intent', a });
      online.awaiting = true;
      clearTimeout(awaitTimer);
      awaitTimer = setTimeout(() => { online.awaiting = false; refresh(); }, 5000);
      refresh();
      return;
    }
    if (online.role === 'host' && !online.connected && (a.k === 'roll' || a.k === 'opening')) {
      toast(`Чакаме ${online.peerName || 'приятеля'} да се свърже — заровете се хвърлят от двамата`, 2600);
      return;
    }
    const seat = online.role === 'host' ? LIGHT : null;
    enqueue(() => (allowed(a, seat) ? commit(a) : undefined));
  }

  /** The checker already in someone's hand for this move, so it flies on from there. */
  function heldChecker(a) {
    let el = null;
    if (a.k === 'move') {
      const top = topChecker(state.turn, a.path[0].from);
      if (localDropped && localDropped === top) el = localDropped;
      else if (remoteDrag && remoteDrag.el === top) el = remoteDrag.el;
    }
    if (remoteDrag && remoteDrag.el !== el) settleRemoteDrag();
    localDropped = null;
    remoteDrag = null;
    remoteSel = null;
    return el;
  }

  /** Shows an action on screen, from `prev` to `next`. */
  async function present(prev, a, next) {
    clearTimeout(autoTimer);
    if ((a.k === 'roll' || a.k === 'opening') && online.role === 'guest') checkFair(a);
    const held = heldChecker(a);
    switch (a.k) {
      case 'opening': {
        state = next;
        await throwDice([
          { v: a.dice[0], x: sideX(LIGHT), y: G.MID, from: LIGHT },
          { v: a.dice[1], x: sideX(DARK), y: G.MID, from: DARK },
        ]);
        if (next.phase === 'opening') {
          toast('Равни зарове — хвърлете отново');
          break;
        }
        await wait(350);
        banner(`${next.players[next.turn].name} започва`);
        await wait(900);
        syncDice();
        await wait(300);
        afterRoll();
        break;
      }
      case 'roll': {
        state = next;
        const specs = diceLayout(next).map((s, i) => ({ ...s, used: false, extra: i >= 2 }));
        await throwDice(specs, next.turn);
        syncDice();
        afterRoll();
        break;
      }
      case 'move': {
        const mover = prev.turn;
        let s = prev;
        for (let k = 0; k < a.path.length; k++) {
          const m = a.path[k];
          s = E.play(s, m);
          state = s;
          syncDice();
          if (m.hit) setTimeout(() => Sound.hit(), dur(330));
          await reconcile(state.board, {
            mover,
            hitDelay: 330,
            dragged: k === 0 ? held : null,
            onLand: (el) => { if (el._p === mover) (m.to === OFF ? Sound.off() : Sound.checker()); },
          });
          updateCards();
        }
        state = next;
        if (next.phase === 'gameover' || next.phase === 'matchover') {
          await wait(400);
          showOver(prev.score);
          break;
        }
        movesNow = E.currentMoves(state);
        if (!state.remaining.length || !movesNow.length) scheduleAutoDone(650);
        break;
      }
      case 'done':
        state = next;
        Sound.tap();
        syncDice();
        refresh();
        banner(online.role && next.turn === online.seat ? 'Твой ред е' : `Ред е на ${next.players[next.turn].name}`, 1100);
        break;
      case 'rename':
        state = next;
        if (online.role === 'guest' && a.seat === online.seat) {
          online.myName = a.name;
          store(GUEST_STORE, { ...(readStore(GUEST_STORE) || {}), name: a.name });
        }
        if (online.role === 'host' && a.seat === online.seat) online.myName = a.name;
        if (online.role && a.seat !== online.seat) online.peerName = a.name;
        break;
      case 'undo':
        hideOverlay('#over');
        state = next;
        Sound.tap();
        syncDice();
        await reconcile(state.board);
        break;
      case 'start': case 'next': case 'rematch': case 'restart': {
        hideOverlay('#over');
        state = next;
        syncDice();
        refresh();
        await reconcile(state.board, { stagger: 28 });
        banner({ start: 'Започваме!', next: `Игра ${next.gameNo + 1}`, rematch: 'Реванш!', restart: 'Отначало' }[a.k]);
        break;
      }
    }
    state = next;
  }

  function afterRoll() {
    movesNow = E.currentMoves(state);
    if (!movesNow.length) {
      toast(myTurn() ? 'Няма възможен ход' : `${state.players[state.turn].name} няма възможен ход`);
      Sound.error();
      scheduleAutoDone(1500);
    }
  }

  let autoTimer = 0;
  function scheduleAutoDone(ms) {
    clearTimeout(autoTimer);
    if (!settings.autoDone || !myTurn()) return;
    const at = state;
    autoTimer = setTimeout(() => { if (state === at && !busy) request({ k: 'done' }); }, ms);
  }

  function actMain() {
    const k = { opening: 'opening', roll: 'roll', move: 'done', gameover: 'next', matchover: 'rematch' }[state.phase];
    if (k) request({ k });
  }

  // ---------- game over ----------
  function showOver(prev) {
    const r = state.result;
    const name = state.players[r.winner].name;
    const matchOver = state.phase === 'matchover';
    const iWon = online.role && r.winner === online.seat;
    const iLost = online.role && r.winner !== online.seat;
    $('#overTitle').textContent = iWon ? (matchOver ? 'Печелиш мача!' : 'Печелиш!')
      : iLost ? (matchOver ? `${name} печели мача` : `${name} печели`)
        : matchOver ? `${name} печели мача!` : `${name} печели!`;
    $('#overKind').textContent = { single: 'Победа · +1', gammon: 'Марс! · +2', backgammon: 'Бекгамон! · +3' }[r.kind];
    for (const p of [LIGHT, DARK]) {
      $('#overName' + p).textContent = state.players[p].name;
      $('#overScore' + p).textContent = String(prev[p]);
    }
    $('#overTarget').textContent = state.matchTo ? `Мач до ${state.matchTo}` : 'Свободна игра';
    $('#overNext').textContent = matchOver ? 'Реванш' : 'Следваща игра';
    $('#overNew').hidden = !matchOver || online.role === 'guest';
    $('#overUndo').hidden = !!online.role;
    showOverlay('#over');
    Sound.win(matchOver && !iLost);
    if (!iLost) confetti(matchOver ? 260 : 110);
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
    const f = o.querySelector('.btn.primary:not([hidden]), input:not([readonly]), .btn:not([hidden])');
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
    send({ t: 'sel', from });
    updateHighlights();
  }

  function clearSelection() {
    if (!selected) return;
    selected = null;
    send({ t: 'sel', from: null });
    updateHighlights();
  }

  function onPointerDown(e) {
    if (busy || online.awaiting || anyOverlay() || e.button > 0) return;
    const { x, y } = toBoard(e);
    if (state.phase === 'opening' || (state.phase === 'roll' && myTurn())) { actMain(); return; }
    if (state.phase !== 'move' || !myTurn()) return;
    const loc = locAt(x, y);
    if (selected && loc !== null && selected.dests.has(String(loc))) {
      request({ k: 'move', path: selected.dests.get(String(loc)) });
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
    const now = performance.now();
    if (online.role && now - dragSentAt > 40) {
      dragSentAt = now;
      send({ t: 'drag', from: drag.loc, x: Math.round(x), y: Math.round(y) });
    }
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
      localDropped = d.el;
      request({ k: 'move', path: selected.dests.get(String(loc)) });
      return;
    }
    // dropped somewhere illegal: back home
    send({ t: 'drop' });
    flyTo(d.el, restingPlace(state.turn, d.loc), { fromDrag: true });
    if (loc !== d.loc) Sound.error();
  }

  function restingPlace(p, loc) {
    const arr = stacks[p].get(keyOf(loc));
    return slot(p, keyOf(loc), arr.indexOf(topChecker(p, loc)), arr.length);
  }

  function onDoubleClick(e) {
    if (busy || online.awaiting || state.phase !== 'move' || !myTurn()) return;
    const { x, y } = toBoard(e);
    const loc = locAt(x, y);
    if (loc === null || !sources.has(loc)) return;
    const dests = E.destinations(state.board, state.turn, state.remaining, loc);
    let best = null;
    for (const path of dests.values()) {
      if (path.length !== 1) continue;
      if (!best || path[0].die > best[0].die) best = path;
    }
    if (best) request({ k: 'move', path: best });
  }

  // The other player's hand, seen from this side of the table (mirrored).
  function onRemoteDrag(msg) {
    if (busy || state.phase !== 'move' || myTurn()) return;
    const el = topChecker(state.turn, msg.from);
    if (!el) return;
    if (remoteDrag && remoteDrag.el !== el) settleRemoteDrag();
    remoteDrag = { el, from: msg.from };
    el.classList.add('dragging', 'lifted');
    el.style.zIndex = '800';
    el.getAnimations().forEach((a) => a.cancel());
    place(el, { x: msg.x, y: G.H - msg.y });
  }

  function settleRemoteDrag() {
    if (!remoteDrag) return;
    const { el, from } = remoteDrag;
    remoteDrag = null;
    if (stacks[el._p].get(keyOf(from)).includes(el)) flyTo(el, restingPlace(el._p, from), { fromDrag: true });
    else el.classList.remove('dragging', 'lifted');
  }

  // ---------- keyboard ----------
  function onKey(e) {
    if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') return;
    if (e.key === 'Escape') {
      if ($('#rename').classList.contains('show')) hideOverlay('#rename');
      else if ($('#rules').classList.contains('show')) hideOverlay('#rules');
      else if ($('#menu').classList.contains('show')) hideOverlay('#menu');
      else clearSelection();
      return;
    }
    if (anyOverlay()) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); request({ k: 'undo' }); return; }
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
  const GUEST_STORE = 'tabla.guest';
  const SETTINGS_STORE = 'tabla.settings';

  function store(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (_) { /* private mode or file:// without storage: the game still works */ }
  }

  function readStore(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  /** The host keeps the game (it is the referee); the guest keeps only how to get back in. */
  function save() {
    if (!started || online.role === 'guest') return;
    store(STORE, {
      state, history: history.slice(-200), rollLog, matchLength,
      online: online.role === 'host'
        ? { id: online.id, myName: online.myName, peerName: online.peerName, guestToken: online.guestToken, chat: chatLog }
        : null,
    });
  }

  // ---------- online: host ----------
  function netStatusText(s, detail) {
    const friend = online.peerName || 'приятеля';
    if (online.busy) return 'Тази игра е заета — някой друг вече е влязъл с този линк';
    if (s === 'error') return 'Този браузър не може да играе онлайн';
    if (online.left && s !== 'connected') return `${online.peerName || 'Приятелят'} излезе от играта`;
    if (online.role === 'host') {
      if (s === 'starting') return 'Свързване…';
      if (s === 'waiting') return started ? `Чакаме ${friend} да се върне…` : 'Чакаме приятеля да отвори линка…';
      if (s === 'connected') return `Онлайн с ${friend}`;
      if (detail === 'server') return 'Няма интернет — опитвам пак…';
      return `${online.peerName || 'Приятелят'} се разкачи — изчакай да се върне…`;
    }
    if (s === 'connecting') return 'Свързване…';
    if (s === 'connected') return `Онлайн с ${friend}`;
    if (detail === 'host-missing') return 'Играта не е отворена при домакина — опитвам пак…';
    if (detail === 'server') return 'Няма интернет — опитвам пак…';
    return 'Връзката прекъсна — свързвам се пак…';
  }

  function onNetStatus(s, detail) {
    online.connected = s === 'connected';
    online.note = netStatusText(s, detail);
    $('#lobbyStatus').textContent = online.note;
    $('#lobby').classList.toggle('failed', s === 'error' || online.busy);
    if (state) { updateCards(); updateControls(); updateSocial(); }
  }

  function hostOnline(id, restored) {
    online.role = 'host';
    online.seat = LIGHT;
    online.id = id;
    online.link = Net.host(id, { onMessage: onNetMessage, onStatus: onNetStatus, admit });
    if (!restored) showLobby('host');
  }

  /**
   * Who may sit in the guest's seat: the first browser to arrive, and after
   * that only that browser again (it proves it with its secret token).
   * Anyone else holding the link is turned away.
   */
  function admit(hello) {
    const token = typeof hello.token === 'string' ? hello.token.slice(0, 64) : '';
    if (!token) return false;
    if (!online.guestToken) {
      online.guestToken = token;
      save();
      return true;
    }
    return token === online.guestToken;
  }

  function sendSync(fresh) {
    send({ t: 'sync', state, fresh: !!fresh, hostName: online.myName, chat: chatLog });
  }

  // ---------- online: fair dice ----------
  const Fair = window.TablaFair;
  const randomBytes = (a) => crypto.getRandomValues(a);
  const fair = { k: 0, hostSeed: '', commit: '', guestSeed: '' }; // the host's side
  const fairGuest = { commits: {}, mySeeds: {} }; // the guest's side

  /** The host locks in its half of the next throw and shows the guest only its fingerprint. */
  function newCommit() {
    fair.k += 1;
    fair.hostSeed = Fair.newSeed(randomBytes);
    fair.commit = Fair.fingerprint(fair.hostSeed);
    fair.guestSeed = '';
    send({ t: 'commit', k: fair.k, commit: fair.commit });
  }

  /** Both halves together: the throw. Waits for the guest's half; null if it never comes. */
  async function fairThrow() {
    if (!fair.commit) newCommit();
    const until = Date.now() + 15000;
    let resent = Date.now();
    while (!fair.guestSeed) {
      if (!online.connected || Date.now() > until) return null;
      if (Date.now() - resent > 2000) {
        send({ t: 'commit', k: fair.k, commit: fair.commit });
        resent = Date.now();
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    const proof = { k: fair.k, hostSeed: fair.hostSeed, guestSeed: fair.guestSeed };
    const dice = Fair.diceFrom(proof.hostSeed, proof.guestSeed);
    newCommit();
    return { dice, fair: proof };
  }

  /** The guest checks every throw before believing it. */
  function checkFair(a) {
    const f = a.fair || {};
    const ok = Fair.verify({
      commit: fairGuest.commits[f.k],
      hostSeed: f.hostSeed,
      guestSeed: f.guestSeed,
      dice: a.dice,
      myGuestSeed: fairGuest.mySeeds[f.k],
    });
    if (!ok) {
      online.fairWarnings += 1;
      toast('⚠ Това хвърляне не мина проверката за честни зарове', 5000);
    }
  }

  function onCommit(msg) {
    const k = Number(msg.k);
    if (!Number.isInteger(k) || typeof msg.commit !== 'string') return;
    fairGuest.commits[k] = msg.commit.slice(0, 64);
    const seed = fairGuest.mySeeds[k] || (fairGuest.mySeeds[k] = Fair.newSeed(randomBytes));
    for (const old of Object.keys(fairGuest.commits)) {
      if (+old < k - 8) { delete fairGuest.commits[old]; delete fairGuest.mySeeds[old]; }
    }
    send({ t: 'seed', k, seed });
  }

  function onSeed(msg) {
    if (Number(msg.k) !== fair.k || fair.guestSeed || typeof msg.seed !== 'string') return;
    fair.guestSeed = msg.seed.slice(0, 64);
  }

  // ---------- online: chat and reactions ----------
  const EMOJI = ['👍', '😂', '😮', '😤'];
  const CHAT_MAX = 200;
  let chatLog = []; // [{id, from, text}], newest last; the host's copy is the one that is kept
  let unread = 0;
  const lastHeard = { chat: 0, emo: 0 };
  const lastSaid = { chat: 0, emo: 0 };
  /** Too many in a row from the other side are simply dropped. */
  function tooSoon(kind, gap) {
    const now = Date.now();
    if (now - lastHeard[kind] < gap) return true;
    lastHeard[kind] = now;
    return false;
  }

  function addChat(entry) {
    if (chatLog.some((m) => m.id === entry.id)) return;
    chatLog.push(entry);
    if (chatLog.length > 60) chatLog = chatLog.slice(-60);
    renderChat();
    if (online.role === 'host') save();
  }

  function renderChat() {
    const list = $('#chatList');
    list.textContent = '';
    if (!chatLog.length) {
      const p = document.createElement('p');
      p.className = 'chat-empty';
      p.textContent = 'Още няма съобщения. Кажи здрасти!';
      list.appendChild(p);
    }
    for (const m of chatLog) {
      const row = document.createElement('div');
      row.className = 'msg ' + (m.from === online.seat ? 'mine' : 'theirs');
      row.textContent = m.text; // text only: nothing a friend types can run as code here
      list.appendChild(row);
    }
    list.scrollTop = list.scrollHeight;
  }

  const chatOpen = () => $('#chat').classList.contains('open');

  function setChatOpen(open) {
    $('#chat').classList.toggle('open', open);
    $('#chat').setAttribute('aria-hidden', open ? 'false' : 'true');
    $('#chatBtn').setAttribute('aria-expanded', String(open));
    if (open) {
      unread = 0;
      renderChat();
      setTimeout(() => $('#chatInput').focus({ preventScroll: true }), 60);
    }
    updateSocial();
  }

  function updateSocial() {
    const on = !!online.role && started;
    $('#social').hidden = !on;
    if (!on && chatOpen()) setChatOpen(false);
    const badge = $('#chatBadge');
    badge.hidden = !unread;
    badge.textContent = String(unread);
    $('#chatTitle').textContent = online.peerName ? `Чат с ${online.peerName}` : 'Чат';
    document.querySelectorAll('#social .emo').forEach((b) => { b.disabled = !online.connected; });
  }

  function sendChat(text) {
    const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (!clean || !online.connected) return false;
    const now = Date.now();
    if (now - lastSaid.chat < 600) return false;
    lastSaid.chat = now;
    const entry = { id: Net.newId().slice(6), from: online.seat, text: clean };
    send({ t: 'chat', id: entry.id, text: clean });
    addChat(entry);
    Sound.tap();
    return true;
  }

  function onChat(msg) {
    if (tooSoon('chat', 400)) return;
    const text = typeof msg.text === 'string' ? msg.text.replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX) : '';
    const id = typeof msg.id === 'string' ? msg.id.slice(0, 24) : '';
    if (!text || !id) return;
    addChat({ id, from: 1 - online.seat, text });
    Sound.message();
    if (!chatOpen()) {
      unread += 1;
      updateSocial();
      bubble(1 - online.seat, text);
    }
  }

  /** A speech bubble by the player's card, for a moment. */
  function bubble(p, text) {
    const r = cardOf(p).getBoundingClientRect();
    const b = document.createElement('div');
    b.className = 'bubble ' + (atBottom(p) ? 'from-bottom' : 'from-top');
    b.textContent = text;
    b.style.left = Math.min(innerWidth - 16, Math.max(16, r.left + 24)) + 'px';
    b.style.top = (atBottom(p) ? r.top - 8 : r.bottom + 8) + 'px';
    document.body.appendChild(b);
    b.addEventListener('click', () => setChatOpen(true));
    b.animate([
      { opacity: 0, transform: `translateY(${atBottom(p) ? 10 : -10}px) scale(0.9)` },
      { opacity: 1, transform: 'none', offset: 0.06 },
      { opacity: 1, transform: 'none', offset: 0.9 },
      { opacity: 0, transform: 'scale(0.96)' },
    ], { duration: reduced.matches ? 4000 : 4200, easing: EASE_OUT }).finished.then(() => b.remove(), () => b.remove());
  }

  function sendEmoji(e) {
    if (!EMOJI.includes(e) || !online.connected) return;
    const now = Date.now();
    if (now - lastSaid.emo < 450) return;
    lastSaid.emo = now;
    send({ t: 'emo', e });
    flyEmoji(online.seat, e);
  }

  function onEmoji(msg) {
    if (!EMOJI.includes(msg.e) || tooSoon('emo', 300)) return;
    flyEmoji(1 - online.seat, msg.e);
  }

  /** The reaction rises from the sender's card over the board. */
  function flyEmoji(p, e) {
    const card = cardOf(p).getBoundingClientRect();
    const board = $('#boardBox').getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'flying-emoji';
    el.textContent = e;
    const x0 = card.left + card.width / 2;
    const y0 = card.top + card.height / 2;
    const x1 = board.left + board.width * (0.35 + Math.random() * 0.3);
    const y1 = board.top + board.height * (atBottom(p) ? 0.35 : 0.65);
    el.style.left = x0 + 'px';
    el.style.top = y0 + 'px';
    document.body.appendChild(el);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const spin = Math.random() < 0.5 ? -18 : 18;
    Sound.pop();
    el.animate([
      { transform: 'translate(-50%, -50%) scale(0.3)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.45}px), calc(-50% + ${dy * 0.45}px)) scale(1.9) rotate(${spin}deg)`, opacity: 1, offset: 0.35 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.5) rotate(${-spin / 2}deg)`, opacity: 1, offset: 0.75 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy - 40}px)) scale(1.3)`, opacity: 0 },
    ], { duration: reduced.matches ? 1200 : 1700, easing: EASE_OUT }).finished.then(() => el.remove(), () => el.remove());
  }

  function bindSocial() {
    const bar = $('#emojiBar');
    for (const e of EMOJI) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'emo';
      b.textContent = e;
      b.setAttribute('aria-label', 'Реакция ' + e);
      b.addEventListener('click', () => sendEmoji(e));
      bar.appendChild(b);
    }
    $('#chatBtn').addEventListener('click', () => setChatOpen(!chatOpen()));
    $('#chatClose').addEventListener('click', () => setChatOpen(false));
    $('#chatForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#chatInput');
      if (sendChat(input.value)) input.value = '';
    });
    $('#chatInput').addEventListener('keydown', (e) => { if (e.key === 'Escape') setChatOpen(false); });
  }

  function onNetMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'open':
        if (online.role === 'guest') send({ t: 'hello', name: online.myName, token: online.guestToken, v: 2 });
        break;
      case 'hello':
        if (online.role !== 'host') break;
        online.peerName = cleanName(msg.name, 'Приятел');
        online.left = false;
        if (!started) {
          startMatch([online.myName, online.peerName], matchLength);
          enqueue(() => sendSync(true));
        } else {
          if (state.players[DARK].name !== online.peerName) {
            state = { ...state, players: [state.players[LIGHT], { name: online.peerName }] };
          }
          enqueue(() => sendSync(false));
        }
        // a fresh lock for the next throw, now that the guest is (back) here
        enqueue(() => newCommit());
        toast(`${online.peerName} е тук`);
        onNetStatus('connected');
        break;
      case 'busy':
        if (online.role !== 'guest') break;
        online.busy = true;
        online.link.close();
        onNetStatus('error');
        showOverlay('#lobby');
        break;
      case 'sync':
        if (online.role === 'guest') applySync(msg);
        break;
      case 'intent':
        if (online.role !== 'host') break;
        enqueue(() => (allowed(msg.a, DARK) ? commit(msg.a) : sendSync(false)));
        break;
      case 'act':
        if (online.role !== 'guest') break;
        online.awaiting = false;
        clearTimeout(awaitTimer);
        enqueue(() => present(state, msg.a, msg.state));
        break;
      case 'commit':
        if (online.role === 'guest') onCommit(msg);
        break;
      case 'seed':
        if (online.role === 'host') onSeed(msg);
        break;
      case 'chat':
        onChat(msg);
        break;
      case 'emo':
        onEmoji(msg);
        break;
      case 'drag':
        if (typeof msg.x === 'number' && typeof msg.y === 'number') onRemoteDrag(msg);
        break;
      case 'drop':
        settleRemoteDrag();
        break;
      case 'sel':
        remoteSel = msg.from;
        if (!busy) updateHighlights();
        break;
      case 'bye':
        online.connected = false;
        online.left = true;
        online.note = `${online.peerName || 'Приятелят'} излезе от играта`;
        toast(online.note, 3000);
        if (state) { updateCards(); updateControls(); updateSocial(); }
        break;
    }
  }

  // ---------- online: guest ----------
  function joinOnline(hostId, name) {
    online.role = 'guest';
    online.seat = DARK;
    online.id = hostId;
    online.myName = name;
    online.busy = false;
    const g = readStore(GUEST_STORE);
    online.guestToken = g && g.hostId === hostId && g.token ? g.token : Net.newToken();
    store(GUEST_STORE, { hostId, name, token: online.guestToken });
    state = { ...state, players: [{ name: '…' }, { name }] };
    setView(DARK);
    showLobby('guest');
    online.link = Net.join(hostId, { onMessage: onNetMessage, onStatus: onNetStatus });
  }

  function applySync(msg) {
    online.awaiting = false;
    online.left = false;
    online.peerName = cleanName(msg.hostName || msg.state.players[LIGHT].name, 'Приятел');
    online.note = `Онлайн с ${online.peerName}`;
    started = true; // for the chat and reactions; the guest still saves nothing
    if (Array.isArray(msg.chat)) {
      chatLog = msg.chat.filter((m) => m && typeof m.text === 'string' && typeof m.id === 'string')
        .slice(-60).map((m) => ({ id: m.id, from: m.from === LIGHT ? LIGHT : DARK, text: m.text.slice(0, CHAT_MAX) }));
      renderChat();
    }
    hideOverlay('#lobby');
    hideOverlay('#setup');
    updateSocial();
    enqueue(async () => {
      if (msg.fresh) {
        await present(state, { k: 'start' }, msg.state);
        return;
      }
      hideOverlay('#over');
      state = msg.state;
      syncDice();
      await reconcile(state.board);
      if (state.phase === 'gameover' || state.phase === 'matchover') showOver(state.score);
    });
  }

  function showLobby(role) {
    const host = role === 'host';
    $('#lobbyTitle').textContent = host ? 'Покани приятел' : 'Влизаш в играта';
    $('#lobbyText').textContent = host
      ? 'Напиши името си и прати линка на приятеля си. Щом го отвори, играта започва. Ти играеш със светлите.'
      : 'Свързваме те с приятеля ти. Ти играеш с тъмните.';
    $('#hostNameField').hidden = !host;
    $('#nameFirst').hidden = true;
    $('#invite').hidden = !host;
    $('#shareBtn').hidden = !host || !navigator.share;
    if (host) {
      $('#inviteLink').value = Net.inviteLink(online.id);
      $('#hostName').value = online.myName;
      lobbyNameChanged();
    }
    hideOverlay('#setup');
    showOverlay('#lobby');
    if (host && !online.myName) setTimeout(() => $('#hostName').focus(), 80);
  }

  /** The link is handed out only once the host has a name, so nobody plays as "Играч 1". */
  function lobbyNameChanged() {
    online.myName = cleanName($('#hostName').value, '');
    const ready = !!online.myName;
    $('#invite').classList.toggle('locked', !ready);
    $('#copyBtn').disabled = !ready;
    $('#shareBtn').disabled = !ready;
    $('#nameFirst').hidden = ready;
  }

  function leaveOnline() {
    if (online.link) online.link.close();
    const wasGuest = online.role === 'guest';
    Object.assign(online, { role: null, seat: null, id: null, link: null, peerName: '', connected: false, awaiting: false, note: '', left: false, busy: false, guestToken: '' });
    chatLog = [];
    unread = 0;
    fair.commit = '';
    if (wasGuest) {
      store(GUEST_STORE, null);
      started = false;
    }
    if (location.hash) clearHash();
    setView(LIGHT);
    setChatOpen(false);
    $('#joinNote').hidden = true;
    document.querySelectorAll('.host-only').forEach((el) => { el.hidden = false; });
  }
  function clearHash() {
    try { window.history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* file:// */ }
  }

  // ---------- setup ----------
  function startMatch(names, length) {
    const prev = state;
    state = E.newMatch(names, length);
    history = [];
    rollLog = {};
    started = true;
    hideOverlay('#setup');
    hideOverlay('#lobby');
    const next = state;
    state = prev;
    enqueue(() => present(prev, { k: 'start' }, next));
  }

  function resume(saved) {
    history = saved.history || [];
    rollLog = saved.rollLog || {};
    started = true;
    hideOverlay('#setup');
    if (saved.online) {
      online.myName = saved.online.myName;
      online.peerName = saved.online.peerName || '';
      online.guestToken = saved.online.guestToken || '';
      chatLog = Array.isArray(saved.online.chat) ? saved.online.chat : [];
      hostOnline(saved.online.id, true);
    }
    enqueue(async () => {
      state = saved.state;
      syncDice();
      await reconcile(state.board, { stagger: 20 });
      if (state.phase === 'gameover' || state.phase === 'matchover') showOver(state.score);
    });
  }

  function names() {
    const n0 = $('#name0').value.trim() || $('#name0').placeholder;
    let n1 = $('#name1').value.trim() || $('#name1').placeholder;
    if (n1 === n0) n1 += ' 2';
    return [n0, n1];
  }

  function bindSetup(saved, joinId) {
    const chips = document.querySelectorAll('#lengthChips button');
    const pick = (v) => {
      matchLength = v;
      chips.forEach((c) => c.classList.toggle('on', +c.dataset.v === v));
    };
    chips.forEach((c) => c.addEventListener('click', () => { pick(+c.dataset.v); Sound.tap(); }));
    pick(saved && saved.matchLength !== undefined ? saved.matchLength : 5);
    if (saved && saved.state) {
      $('#name0').value = saved.state.players[0].name;
      if (!saved.online) $('#name1').value = saved.state.players[1].name;
      if (saved.state.phase !== 'matchover' && !joinId) {
        $('#resumeBtn').hidden = false;
        $('#resumeBtn').textContent = saved.online ? `Продължи онлайн играта с ${saved.online.peerName || 'приятел'}` : 'Продължи играта';
        $('#resumeBtn').addEventListener('click', () => resume(saved), { once: true });
      }
    }
    if (joinId) {
      // opened from a friend's invite
      $('#setupForm').classList.add('joining');
      $('#joinNote').hidden = false;
      document.querySelectorAll('.host-only').forEach((el) => { el.hidden = true; });
      const g = readStore(GUEST_STORE);
      $('#name1').value = g && g.name ? g.name : '';
      $('#startBtn').textContent = 'Влез в играта';
      $('#name1').closest('.field').querySelector('.lbl').textContent = 'Твоето име';
    }
    $('#setupForm').addEventListener('submit', (e) => {
      e.preventDefault();
      $('#resumeBtn').hidden = true;
      const [n0, n1] = names();
      if ($('#setupForm').classList.contains('joining')) {
        const mine = cleanName($('#name1').value, '');
        if (!mine) { nudge('#name1'); return; }
        $('#setupForm').classList.remove('joining');
        joinOnline(joinId, mine);
        return;
      }
      startMatch([n0, n1], matchLength);
    });
    $('#hostBtn').addEventListener('click', () => {
      $('#resumeBtn').hidden = true;
      online.myName = cleanName($('#name0').value, '');
      online.peerName = '';
      online.guestToken = '';
      chatLog = [];
      started = false;
      hostOnline(Net.newId(), false);
    });
  }

  /** Points at a field that still needs filling in. */
  function nudge(sel) {
    const el = $(sel);
    el.focus();
    el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: dur(260), iterations: 2 });
    Sound.error();
  }

  function bindLobby() {
    $('#hostName').addEventListener('input', lobbyNameChanged);
    $('#copyBtn').addEventListener('click', async () => {
      if (!online.myName) { nudge('#hostName'); return; }
      const input = $('#inviteLink');
      try { await navigator.clipboard.writeText(input.value); } catch (_) { input.select(); document.execCommand('copy'); }
      $('#copyBtn').textContent = 'Копирано ✓';
      setTimeout(() => { $('#copyBtn').textContent = 'Копирай'; }, 1600);
    });
    $('#shareBtn').addEventListener('click', () => {
      if (!online.myName) { nudge('#hostName'); return; }
      navigator.share({ title: 'Табла', text: `${online.myName} те кани на табла!`, url: $('#inviteLink').value }).catch(() => {});
    });
    $('#lobbyCancel').addEventListener('click', () => {
      leaveOnline();
      hideOverlay('#lobby');
      showOverlay('#setup');
    });
  }

  // ---------- names ----------
  function openRename() {
    for (const p of [LIGHT, DARK]) {
      const row = $('#renameRow' + p);
      const mine = !online.role || online.seat === p;
      row.hidden = !mine;
      $('#renameInput' + p).value = state.players[p].name;
      row.querySelector('.lbl').textContent = online.role ? 'Твоето име' : p === LIGHT ? 'Светли пулове' : 'Тъмни пулове';
    }
    hideOverlay('#menu');
    showOverlay('#rename');
  }

  function bindRename() {
    $('#renameForm').addEventListener('submit', (e) => {
      e.preventDefault();
      for (const p of [LIGHT, DARK]) {
        if ($('#renameRow' + p).hidden) continue;
        const name = cleanName($('#renameInput' + p).value, '');
        if (!name) { nudge('#renameInput' + p); return; }
        if (name !== state.players[p].name) request({ k: 'rename', seat: p, name });
      }
      hideOverlay('#rename');
    });
  }

  function bindMenu() {
    $('#menuBtn').addEventListener('click', () => {
      if (busy) return;
      document.querySelectorAll('#menu .armed').forEach((b) => { b.classList.remove('armed'); b.textContent = b.dataset.label; });
      $('#leaveBtn').hidden = !online.role;
      document.querySelectorAll('#menu [data-act="restart"]').forEach((b) => { b.hidden = online.role === 'guest'; });
      document.querySelectorAll('#menu [data-act="newmatch"]').forEach((b) => { b.hidden = !!online.role; });
      showOverlay('#menu');
    });
    const calm = $('#optCalm');
    calm.checked = settings.calm;
    calm.addEventListener('change', () => {
      settings.calm = calm.checked;
      document.documentElement.classList.toggle('calm', settings.calm);
      store(SETTINGS_STORE, settings);
    });
    const sound = $('#optSound');
    const auto = $('#optAuto');
    sound.checked = settings.sound;
    auto.checked = settings.autoDone;
    sound.addEventListener('change', () => { settings.sound = Sound.enabled = sound.checked; Sound.tap(); store(SETTINGS_STORE, settings); });
    auto.addEventListener('change', () => { settings.autoDone = auto.checked; store(SETTINGS_STORE, settings); if (turnDone()) scheduleAutoDone(400); });
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
        else if (act === 'rename') { openRename(); }
        else if (act === 'restart') { hideOverlay('#menu'); request({ k: 'restart' }); }
        else if (act === 'newmatch' || act === 'leave') {
          hideOverlay('#menu'); hideOverlay('#over');
          if (online.role) leaveOnline();
          started = false;
          store(STORE, null);
          $('#resumeBtn').hidden = true;
          showOverlay('#setup');
        }
        else if (act === 'undo') request({ k: 'undo' });
        else if (act === 'next') actMain();
      });
    });
    document.querySelectorAll('.overlay').forEach((o) => {
      o.addEventListener('pointerdown', (e) => {
        if (e.target === o && (o.id === 'menu' || o.id === 'rules' || o.id === 'rename')) hideOverlay('#' + o.id);
      });
    });
  }

  // ---------- boot ----------
  function boot() {
    buildBoardArt();
    buildHighlights();
    buildCheckers();
    buildDice();
    const saved = readStore(STORE);
    const oldSettings = saved && saved.settings; // saved inside the game before version 2
    settings = { ...settings, ...(oldSettings || {}), ...(readStore(SETTINGS_STORE) || {}) };
    Sound.enabled = settings.sound;
    document.documentElement.classList.toggle('calm', !!settings.calm);
    state = E.newMatch(['Играч 1', 'Играч 2'], 5);
    state = { ...state, board: { points: new Array(24).fill(0), bar: [0, 0], off: [15, 15] } };
    reconcile(state.board, { animate: false });
    fit();
    new ResizeObserver(fit).observe($('#boardWrap'));
    const joinId = Net.joinIdFromUrl();
    if (joinId && saved && saved.online && saved.online.id === joinId) clearHash(); // the host opened their own invite
    const inviteFromFriend = joinId && !(saved && saved.online && saved.online.id === joinId) ? joinId : null;
    refresh();
    bindSetup(saved, inviteFromFriend);
    bindLobby();
    bindMenu();
    bindRename();
    bindSocial();
    renderChat();
    const board = $('#board');
    board.addEventListener('pointerdown', onPointerDown);
    board.addEventListener('pointermove', onPointerMove);
    board.addEventListener('pointerup', onPointerUp);
    board.addEventListener('pointercancel', onPointerUp);
    board.addEventListener('dblclick', onDoubleClick);
    $('#mainBtn').addEventListener('click', actMain);
    $('#undoBtn').addEventListener('click', () => request({ k: 'undo' }));
    document.addEventListener('keydown', onKey);
    // back in the same game after a reload: go straight in
    const g = readStore(GUEST_STORE);
    if (inviteFromFriend && g && g.hostId === inviteFromFriend && g.name) {
      hideOverlay('#setup');
      joinOnline(inviteFromFriend, g.name);
    } else {
      setTimeout(() => $(inviteFromFriend ? '#name1' : '#name0').focus({ preventScroll: true }), 300);
    }
    // for automated checks only
    window.__tabla = {
      get state() { return state; }, get busy() { return busy; }, get online() { return online; },
      get chat() { return chatLog; },
      request, E,
    };
  }

  boot();
})();
