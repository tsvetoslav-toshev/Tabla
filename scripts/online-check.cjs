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
  await host.click('#lengthChips [data-v="3"]');
  await host.click('#hostBtn');
  await host.waitForFunction(() => document.querySelector('#inviteLink').value.includes('#join='));
  // no name yet: the link stays locked until the host types one
  if (!(await host.isDisabled('#copyBtn'))) throw new Error('the invite can be copied before the host has a name');
  await host.fill('#hostName', 'Иван');
  if (await host.isDisabled('#copyBtn')) throw new Error('the invite stays locked after the host typed a name');
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

  // chat: text only, both ways; markup arrives as plain text
  await guest.click('#chatBtn');
  await guest.fill('#chatInput', '<b>Здрасти</b> <img src=x onerror=alert(1)>');
  await guest.press('#chatInput', 'Enter');
  await host.waitForFunction(() => window.__tabla.chat.length === 1, null, { timeout: 10000 });
  if (!(await host.isVisible('.bubble'))) throw new Error('no chat bubble on the host');
  if (await host.locator('#chatList b, #chatList img, .bubble b, .bubble img').count()) throw new Error('chat markup was rendered as HTML');
  const badge = await host.textContent('#chatBadge');
  if (badge !== '1') throw new Error('unread badge shows ' + badge);
  await host.screenshot({ path: path.join(out, 'online-host-bubble.png') });
  await host.click('#chatBtn');
  await host.fill('#chatInput', 'Здрасти, Мария!');
  await host.press('#chatInput', 'Enter');
  await guest.waitForFunction(() => window.__tabla.chat.length === 2, null, { timeout: 10000 });
  await guest.waitForTimeout(400);
  await guest.screenshot({ path: path.join(out, 'online-guest-chat.png') });
  await host.click('#chatClose');
  await guest.click('#chatClose');

  // reactions fly on the other screen
  await host.locator('#emojiBar .emo').nth(1).click();
  await guest.waitForSelector('.flying-emoji', { timeout: 5000 });
  await guest.waitForTimeout(500);
  await guest.screenshot({ path: path.join(out, 'online-guest-emoji.png') });

  // someone else with the link is turned away, and the game goes on undisturbed
  const intruder = await open(browser, invite, 'intruder', { width: 800, height: 600 });
  await intruder.fill('#name1', 'Натрапник');
  await intruder.click('#startBtn');
  await intruder.waitForFunction(() => /заета/.test(document.querySelector('#lobbyStatus').textContent), null, { timeout: 20000 })
    .catch(async (e) => { console.log('intruder sees:', await intruder.textContent('#lobbyStatus'), await intruder.evaluate(() => JSON.stringify(window.__tabla.online, (k, v) => (k === 'link' ? undefined : v)))); throw e; });
  await intruder.screenshot({ path: path.join(out, 'online-intruder.png') });
  await intruder.close();
  await host.waitForTimeout(1500);
  if (!(await T(host)).connected || !(await T(guest)).connected) throw new Error('the intruder broke the connection');
  s = await settled(host, guest);
  if (s.players[1].name !== 'Мария') throw new Error('the intruder took the seat');
  console.log('intruder turned away; game undisturbed');

  // the guest renames herself from the menu
  await guest.click('#menuBtn');
  await guest.click('#menu [data-act="rename"]');
  if (await guest.isVisible('#renameRow0')) throw new Error("the guest can rename the host");
  await guest.fill('#renameInput1', 'Мими');
  await guest.click('#renameForm button[type=submit]');
  s = await settled(host, guest);
  if (s.players[1].name !== 'Мими') throw new Error('rename did not reach the host');
  console.log('rename: both screens show Мими');

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
  if ((await guest.evaluate(() => window.__tabla.chat.length)) !== 2) throw new Error('the chat was lost on reload');
  console.log('guest reload: rejoined the same game');

  console.log(`guest dragged: ${guestDragged}, guest undo: ${guestUndid}`);
  const warnings = await guest.evaluate(() => window.__tabla.online.fairWarnings);
  if (warnings) throw new Error(`${warnings} throws failed the fair-dice check`);
  console.log('fair dice: every throw checked out on the guest');

  // the host reloads: "Продължи онлайн играта" brings both back to the same game
  const beforeHostReload = view((await T(host)).s);
  await host.reload();
  await host.click('#resumeBtn');
  await host.waitForFunction(() => window.__tabla.online.connected, null, { timeout: 40000 });
  s = await settled(host, guest, 30000);
  if (view(s) !== beforeHostReload) throw new Error('the game changed across the host reload');
  console.log('host reload: resumed the same game');

  // the end of a game, seen on both screens: the host's last checker comes off
  const pts = new Array(24).fill(0); pts[0] = 1; pts[20] = -15;
  await host.evaluate((pts) => {
    const saved = JSON.parse(localStorage.getItem('tabla.v1'));
    saved.state = { ...saved.state, phase: 'roll', turn: 0, dice: [], remaining: [], board: { points: pts, bar: [0, 0], off: [14, 0] }, score: [1, 0] };
    saved.history = [];
    localStorage.setItem('tabla.v1', JSON.stringify(saved));
  }, pts);
  await host.reload();
  await host.click('#resumeBtn');
  await host.waitForFunction(() => window.__tabla.online.connected, null, { timeout: 40000 });
  await settled(host, guest, 30000);
  await host.click('#mainBtn', { force: true });
  s = await settled(host, guest);
  const last = await host.evaluate(() => window.__tabla.E.currentMoves(window.__tabla.state)[0]);
  await host.evaluate((m) => window.__tabla.request({ k: 'move', path: [m] }), last);
  s = await settled(host, guest);
  if (s.phase !== 'matchover' || s.score[0] !== 3) throw new Error(`expected a 3:0 match win (марс), got ${s.phase} ${s.score}`);
  await guest.waitForSelector('#over.show');
  await host.waitForSelector('#over.show');
  await guest.waitForTimeout(900);
  await guest.screenshot({ path: path.join(out, 'online-guest-lost.png') });
  await host.screenshot({ path: path.join(out, 'online-host-won.png') });
  const guestTitle = await guest.textContent('#overTitle');
  if (!guestTitle.includes('Иван')) throw new Error('guest saw the wrong title: ' + guestTitle);
  // the guest asks for the rematch; both start over at 0:0
  await guest.click('#overNext');
  s = await settled(host, guest);
  if (s.phase !== 'opening' || s.score.join() !== '0,0') throw new Error('rematch did not start on both screens');
  if (await host.isVisible('#over.show')) throw new Error('the host still shows the game-over panel');
  console.log('game over + rematch: agreed on both screens');

  // the guest leaves; the host is told
  await guest.click('#menuBtn');
  await guest.click('#leaveBtn');
  await guest.click('#leaveBtn');
  await host.waitForFunction(() => !window.__tabla.online.connected, null, { timeout: 15000 });
  await host.waitForTimeout(400);
  const note = await host.textContent('#netStatus');
  console.log('host after the guest left:', note);
  await browser.close();
  if (errors.length) { console.error(errors); process.exitCode = 1; } else console.log('online check passed');
})().catch((e) => { console.error(e); console.error(errors); process.exit(1); });
