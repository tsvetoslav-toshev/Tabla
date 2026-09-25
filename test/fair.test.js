const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const F = require('../src/fair.js');

test('sha256 matches Node for short, long and Cyrillic input', () => {
  for (const s of ['', 'abc', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'табла ' .repeat(40)]) {
    assert.equal(F.hex(F.sha256(s)), crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
  }
});

test('dice are 1..6, depend on both seeds, and are roughly uniform', () => {
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 6000; i++) {
    const [a, b] = F.diceFrom('host' + i, 'guest' + i);
    assert.ok(a >= 1 && a <= 6 && b >= 1 && b <= 6);
    counts[a - 1]++;
    counts[b - 1]++;
  }
  for (const c of counts) assert.ok(c > 1800 && c < 2200, `count ${c} out of 2000 ± 200`);
  assert.deepEqual(F.diceFrom('a', 'b'), F.diceFrom('a', 'b'));
});

test('verify accepts an honest throw and rejects every kind of cheating', () => {
  const hostSeed = 'h1';
  const guestSeed = 'g1';
  const commit = F.fingerprint(hostSeed);
  const dice = F.diceFrom(hostSeed, guestSeed);
  assert.ok(F.verify({ commit, hostSeed, guestSeed, dice, myGuestSeed: guestSeed }));
  // the host swaps its seed after seeing the guest's
  assert.ok(!F.verify({ commit, hostSeed: 'h2', guestSeed, dice: F.diceFrom('h2', guestSeed), myGuestSeed: guestSeed }));
  // the host claims the guest sent another seed
  assert.ok(!F.verify({ commit, hostSeed, guestSeed: 'g2', dice: F.diceFrom(hostSeed, 'g2'), myGuestSeed: guestSeed }));
  // the host shows other numbers than the seeds give
  const other = dice[0] === 6 ? [1, dice[1]] : [dice[0] + 1, dice[1]];
  assert.ok(!F.verify({ commit, hostSeed, guestSeed, dice: other, myGuestSeed: guestSeed }));
});
