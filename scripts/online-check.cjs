// Two browsers play online against each other and must always agree.
// Needs a web server for the repo and a PeerJS server, e.g.
//   http-server . -p 8080   and   a PeerServer on 127.0.0.1:9000
// then: node scripts/online-check.cjs [outDir] [baseUrl] [peerHost:port]
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || 'captures';
const base = process.argv[3] || 'http://127.0.0.1:8080/index.html';
const peer = process.argv[4] || '127.0.0.1:9000';
const errors = [];

async function open(browser, url, who, size) {
  const ctx = await browser.newContext({ viewport: size });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${who}: ${m.text()}`); });
  await page.goto(url);
  return page;
}

const T = (page) => page.evaluate(() => {
  const t = window.__tabla;
  return { busy: t.busy, awaiting: t.online.awaiting, connected: t.online.connected, s: t.state };
});
const view = (s) => JSON.stringify([s.board, s.turn, s.phase, s.remaining, s.score, s.players]);

async function settled(a, b, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const [x, y] = [await T(a), await T(b)];
    if (!x.busy && !y.busy && !x.awaiting && !y.awaiting && view(x.s) === view(y.s)) return x.s;
    if (Date.now() > end) throw new Error('the two screens disagree:\n' + view(x.s) + '\n' + view(y.s));
    await a.waitForTimeout(150);
  }
}

(async () => {
  require('node:fs').mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const host = await open(browser, `${base}?peer=${peer}`, 'host', { width: 1280, height: 800 });
  await host.fill('#name0', 'Иван');
  await host.click('#lengthChips [data-v="3"]');
  await host.click('#hostBtn');
  await host.waitForFunction(() => document.querySelector('#inviteLink').value.includes('#join='));
  const invite = await host.inputValue('#inviteLink');
  await host.waitForTimeout(600);
  await host.screenshot({ path: path.join(out, 'online-lobby.png') });

  let guest = await open(browser, invite, 'guest', { width: 844, height: 390 });
  if (!(await guest.isVisible('#joinNote'))) throw new Error('the invite did not open the join screen');
  await guest.screenshot({ path: path.join(out, 'online-join.png') });
  await guest.fill('#name1', 'Мария');
  await guest.click('#startBtn');
  await host.waitForFunction(() => window.__tabla.online.connected, null, { timeout: 20000 });
  let s = await settled(host, guest);
  console.log('connected; phase', s.phase, 'players', s.players.map((p) => p.name).join(' / '));

  const pageFor = (turn) => (turn === 0 ? host : guest);
  let guestDragged = false;
  let guestUndid = false;
  for (let step = 0; step < 14; step++) {
    s = await settled(host, guest);
    if (s.phase === 'opening') { await guest.click('#mainBtn', { force: true }); continue; }
    const p = pageFor(s.turn);
    if (s.phase === 'roll') { await p.click('#mainBtn', { force: true }); continue; }
    if (s.phase !== 'move') break;
    const moves = await p.evaluate(() => window.__tabla.E.currentMoves(window.__tabla.state));
    if (!moves.length || !s.remaining.length) { await p.click('#mainBtn', { force: true }); continue; }
    if (p === guest && !guestDragged && (await guest.locator('.checker.movable').count())) {
      // a real drag on the guest's screen; the host must see the checker travel
      const from = await guest.locator('.checker.movable').first().boundingBox();
      await guest.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await guest.mouse.down();
      await guest.mouse.move(from.x + from.width, from.y + from.height, { steps: 3 });
      const spot = await guest.locator('.spot').first().boundingBox();
      await guest.mouse.move(spot.x + spot.width / 2, spot.y + spot.height / 2 - 30, { steps: 6 });
      await guest.waitForTimeout(200);
      const lifted = await host.locator('.checker.dragging').count();
      await host.screenshot({ path: path.join(out, 'online-host-sees-drag.png') });
      await guest.mouse.move(spot.x + spot.width / 2, spot.y + spot.height / 2, { steps: 2 });
      await guest.mouse.up();
      if (!lifted) throw new Error("the host did not see the guest's checker in hand");
      guestDragged = true;
      s = await settled(host, guest);
      if (!guestUndid && s.phase === 'move' && s.turn === 1) {
        const before = view(s);
        await guest.click('#undoBtn');

        const back = await settled(host, guest);
        if (view(back) === before) throw new Error('guest undo changed nothing');
        guestUndid = true;
      }
      continue;
    }
    await p.evaluate((m) => window.__tabla.request({ k: 'move', path: [m] }), moves[0]);
  }
  s = await settled(host, guest);
  await host.screenshot({ path: path.join(out, 'online-host.png') });
  await guest.screenshot({ path: path.join(out, 'online-guest.png') });

  // the guest may not move on the host's turn
  if (s.turn === 0 && s.phase === 'roll') {
    const before = view(s);
    await guest.evaluate(() => window.__tabla.request({ k: 'roll' }));
    await guest.waitForTimeout(800);
    if (view((await T(guest)).s) !== before) throw new Error('the guest rolled on the host\'s turn');
  }

  // the guest reloads: back in the same game without typing anything
  const beforeReload = view((await T(host)).s);
  await guest.reload();
  await host.waitForTimeout(500);
  await guest.waitForFunction(() => window.__tabla.online.connected, null, { timeout: 30000 });
  s = await settled(host, guest, 30000);
  if (view(s) !== beforeReload) throw new Error('the game changed across the guest reload');
  console.log('guest reload: rejoined the same game');

  console.log(`guest dragged: ${guestDragged}, guest undo: ${guestUndid}`);
  await browser.close();
  if (errors.length) { console.error(errors); process.exitCode = 1; } else console.log('online check passed');
})().catch((e) => { console.error(e); console.error(errors); process.exit(1); });
