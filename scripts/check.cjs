// Plays a few turns in a real browser and takes screenshots: node scripts/check.cjs [outDir]
const path = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const out = process.argv[2] || 'captures';
const file = 'file://' + path.resolve(__dirname, '..', 'index.html');

async function shoot(size, name, drive) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) errors.push('network: ' + r.url()); });
  await page.goto(file);
  await drive(page);
  await page.screenshot({ path: path.join(out, name) });
  await browser.close();
  if (errors.length) { console.error(name, errors); process.exitCode = 1; }
}

const idle = (page) => page.waitForFunction(() => !window.__tabla.busy);

async function play(page, turns) {
  await page.fill('#name0', 'Иван');
  await page.fill('#name1', 'Мария');
  await page.click('#startBtn');
  await page.waitForTimeout(1600);
  await idle(page);
  for (let t = 0; t < turns; t++) {
    await page.click('#mainBtn', { force: true }); // roll (or opening roll)
    await page.waitForTimeout(2600);
    await idle(page);
    for (;;) {
      const moves = await page.evaluate(() => window.__tabla.E.currentMoves(window.__tabla.state));
      const phase = await page.evaluate(() => window.__tabla.state.phase);
      if (phase !== 'move' || !moves.length) break;
      await page.evaluate((m) => window.__tabla.request({ k: 'move', path: [m] }), moves[0]);
      await page.waitForTimeout(100);
      await idle(page);
    }
    const phase = await page.evaluate(() => window.__tabla.state.phase);
    if (phase === 'move') { await page.click('#mainBtn', { force: true }); await page.waitForTimeout(300); }
  }
}

/** Clicks the first checker that can move, so its targets light up. */
async function selectFirst(page) {
  const m = await page.evaluate(() => window.__tabla.E.currentMoves(window.__tabla.state)[0]);
  if (!m) return;
  const pt = await page.evaluate((from) => {
    const el = [...document.querySelectorAll('.checker.movable')].find(Boolean);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, m.from);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(500);
}

(async () => {
  require('node:fs').mkdirSync(out, { recursive: true });
  await shoot({ width: 1440, height: 900 }, 'setup.png', async (p) => { await p.waitForTimeout(800); });
  await shoot({ width: 1440, height: 900 }, 'desktop.png', async (p) => {
    await play(p, 4);
    await p.click('#mainBtn', { force: true }); await p.waitForTimeout(2600); await idle(p);
    await selectFirst(p);
  });
  await shoot({ width: 1280, height: 800 }, 'drag.png', async (p) => {
    await play(p, 2);
    for (let i = 0; i < 12; i++) {
      const ph = await p.evaluate(() => window.__tabla.state.phase);
      if (ph === 'move' && await p.locator('.checker.movable').count()) break;
      await p.click('#mainBtn', { force: true });
      await p.waitForTimeout(2600); await idle(p);
    }
    const before = await p.evaluate(() => JSON.stringify(window.__tabla.state.board));
    const left = await p.evaluate(() => window.__tabla.state.remaining.length);
    const from = await p.locator('.checker.movable').first().boundingBox();
    await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await p.mouse.down();
    await p.mouse.move(from.x + from.width, from.y + from.height, { steps: 4 });
    const spot = await p.locator('.spot').first().boundingBox();
    await p.mouse.move(spot.x + spot.width / 2, spot.y + spot.height / 2, { steps: 8 });
    await p.mouse.up();
    await p.waitForTimeout(900); await idle(p);
    const after = await p.evaluate(() => window.__tabla.state.remaining.length);
    if (after >= left) throw new Error('drag did not move a checker');
    await p.keyboard.press('Control+z');
    await p.waitForTimeout(900); await idle(p);
    const undone = await p.evaluate(() => JSON.stringify(window.__tabla.state.board));
    if (undone !== before) throw new Error('undo did not restore the board');
    // undoing the roll and rolling again must give the same dice
    const dice = await p.evaluate(() => window.__tabla.state.dice.join());
    await p.keyboard.press('Control+z'); await p.waitForTimeout(400); await idle(p);
    await p.click('#mainBtn', { force: true }); await p.waitForTimeout(1500); await idle(p);
    const again = await p.evaluate(() => window.__tabla.state.dice.join());
    if (again !== dice) throw new Error(`re-roll after undo changed the dice: ${dice} -> ${again}`);
  });
  await shoot({ width: 1440, height: 900 }, 'throw.png', async (p) => {
    await play(p, 1);
    await p.click('#mainBtn', { force: true });
    await p.waitForTimeout(380);
  });
  await shoot({ width: 1440, height: 900 }, 'gameover.png', async (p) => {
    // light has one checker left to bear off; dark has none off: a gammon (марс)
    const pts = new Array(24).fill(0); pts[0] = 1; pts[20] = -15;
    const state = {
      players: [{ name: 'Иван' }, { name: 'Мария' }], matchTo: 5, score: [3, 1], gameNo: 2,
      phase: 'roll', board: { points: pts, bar: [0, 0], off: [14, 0] }, turn: 0, dice: [], remaining: [],
      turnSeq: 9, openingRoll: [3, 1], result: null,
    };
    await p.evaluate((st) => localStorage.setItem('tabla.v1', JSON.stringify({ state: st, history: [], rollLog: {}, settings: { sound: false }, matchLength: 5 })), state);
    await p.reload();
    await p.click('#resumeBtn');
    await p.waitForTimeout(1500); await idle(p);
    await p.click('#mainBtn', { force: true });
    await p.waitForTimeout(1500); await idle(p);
    await selectFirst(p);
    const spot = await p.locator('.spot').first().boundingBox();
    await p.mouse.click(spot.x + spot.width / 2, spot.y + spot.height / 2);
    await p.waitForTimeout(2200);
    const phase = await p.evaluate(() => window.__tabla.state.phase);
    if (phase !== 'matchover') throw new Error('expected matchover, got ' + phase);
  });
  await shoot({ width: 390, height: 844 }, 'phone.png', async (p) => { await play(p, 3); });
  await shoot({ width: 844, height: 390 }, 'phone-landscape.png', async (p) => { await play(p, 2); await p.click('#mainBtn', { force: true }); await p.waitForTimeout(2600); await selectFirst(p); });
  console.log('screenshots in', out);
})();
