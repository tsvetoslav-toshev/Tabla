const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

const { LIGHT, DARK, BAR, OFF } = E;

/** Board from a map of index → signed count (positive = light, negative = dark). */
function board(points, extra = {}) {
  const b = { points: new Array(24).fill(0), bar: [0, 0], off: [0, 0], ...extra };
  for (const [i, v] of Object.entries(points)) b.points[Number(i)] = v;
  return b;
}

const moveKeys = (moves) => moves.map((m) => `${m.from}>${m.to}:${m.die}`).sort();

test('starting position has 15 checkers each and 167 pips each', () => {
  const b = E.initialBoard();
  const light = b.points.filter((v) => v > 0).reduce((a, v) => a + v, 0);
  const dark = -b.points.filter((v) => v < 0).reduce((a, v) => a + v, 0);
  assert.equal(light, 15);
  assert.equal(dark, 15);
  assert.equal(E.pipCount(b, LIGHT), 167);
  assert.equal(E.pipCount(b, DARK), 167);
});

test('a point with two opposing checkers is blocked, a blot can be hit', () => {
  const b = board({ 10: 1, 7: -2, 8: -1 });
  const moves = E.singleMoves(b, LIGHT, 3);
  assert.deepEqual(moveKeys(moves), []);
  const hits = E.singleMoves(b, LIGHT, 2);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].hit, true);
  const after = E.applyMove(b, LIGHT, hits[0]);
  assert.equal(after.points[8], 1);
  assert.equal(after.bar[DARK], 1);
});

test('a checker on the bar must enter before anything else moves', () => {
  const b = board({ 12: 3 }, { bar: [1, 0] });
  const moves = E.legalMoves(b, LIGHT, [3, 5]);
  assert.ok(moves.every((m) => m.from === BAR));
  // light enters on 24 - die: index 21 for a 3, 19 for a 5
  assert.deepEqual(moveKeys(moves), ['bar>19:5', 'bar>21:3']);
});

test('dark enters on its own side of the board', () => {
  const b = board({ 12: -3 }, { bar: [0, 1] });
  assert.deepEqual(moveKeys(E.legalMoves(b, DARK, [2, 2, 2, 2])), ['bar>1:2']);
});

test('no entry when the home board is closed', () => {
  const pts = {};
  for (let i = 18; i < 24; i++) pts[i] = -2;
  const b = board(pts, { bar: [1, 0] });
  assert.deepEqual(E.legalMoves(b, LIGHT, [6, 1]), []);
});

test('both dice must be played when possible', () => {
  // Moving 23 by 6 first reaches 17, from where the 1 is blocked at 16;
  // the checker on 20 can play 1 then 6. Only moves that allow both dice survive.
  const b = board({ 23: 1, 16: -2, 11: -2, 20: 1, 13: -2 });
  const moves = E.legalMoves(b, LIGHT, [6, 1]);
  for (const m of moves) {
    const rest = E.legalMoves(E.applyMove(b, LIGHT, m), LIGHT, m.die === 6 ? [1] : [6]);
    assert.ok(rest.length > 0, `move ${m.from}>${m.to} leaves the other die unplayable`);
  }
});

test('if only one die can be played, the larger one must be', () => {
  // A single light checker on 10; 10-5 = 5 open, 10-2 = 8 open, but after
  // either move the other die is blocked.
  const b = board({ 10: 1, 3: -2, 6: -2, 0: -2 });
  // 5 then 2: 5 → 3 blocked. 2 then 5: 8 → 3 blocked.
  const moves = E.legalMoves(b, LIGHT, [2, 5]);
  assert.deepEqual(moveKeys(moves), ['10>5:5']);
});

test('doubles give four moves', () => {
  const s = E.roll(E.newMatch(['A', 'B'], 5), 3, 3);
  assert.deepEqual(s.remaining, [3, 3, 3, 3]);
});

test('bearing off needs every checker home', () => {
  const b = board({ 2: 1, 8: 1 });
  assert.ok(!E.singleMoves(b, LIGHT, 3).some((m) => m.to === OFF));
  const home = board({ 2: 1, 4: 1 });
  assert.ok(E.singleMoves(home, LIGHT, 3).some((m) => m.from === 2 && m.to === OFF));
});

test('a higher die bears off only from the farthest point', () => {
  const b = board({ 1: 1, 3: 1 }); // light checkers on the 2 and 4 points
  const moves = E.singleMoves(b, LIGHT, 6);
  assert.deepEqual(moveKeys(moves), ['3>off:6']);
});

test('dark bears off from its own home', () => {
  const b = board({ 22: -1, 20: -1 }); // dark's 2 and 4 points
  assert.deepEqual(moveKeys(E.singleMoves(b, DARK, 4)), ['20>off:4']);
});

test('scoring: single, gammon (марс) and backgammon', () => {
  assert.deepEqual(E.gameResult(board({ 20: -3 }, { off: [15, 12] })), { winner: LIGHT, points: 1, kind: 'single' });
  assert.deepEqual(E.gameResult(board({ 20: -15 }, { off: [15, 0] })), { winner: LIGHT, points: 2, kind: 'gammon' });
  assert.deepEqual(E.gameResult(board({ 20: -14, 3: -1 }, { off: [15, 0] })), { winner: LIGHT, points: 3, kind: 'backgammon' });
  assert.deepEqual(E.gameResult(board({ 20: -14 }, { off: [15, 0], bar: [0, 1] })), { winner: LIGHT, points: 3, kind: 'backgammon' });
  assert.equal(E.gameResult(E.initialBoard()), null);
});

test('the last checker off ends the game and scores the match', () => {
  let s = E.newMatch(['A', 'B'], 3);
  s = { ...s, board: board({ 0: 1, 20: -15 }, { off: [14, 0] }), phase: 'move', turn: LIGHT, remaining: [1, 4] };
  s = E.play(s, { from: 0, to: OFF, die: 1 });
  assert.equal(s.phase, 'gameover');
  assert.deepEqual(s.score, [2, 0]);
  s = E.nextGame(s);
  s = { ...s, board: board({ 0: 1, 20: -15 }, { off: [14, 0] }), phase: 'move', turn: LIGHT, remaining: [1, 4] };
  s = E.play(s, { from: 0, to: OFF, die: 1 });
  assert.equal(s.phase, 'matchover');
  assert.deepEqual(s.score, [4, 0]);
});

test('opening roll: a tie rolls again, otherwise the higher die starts with both', () => {
  const s = E.newMatch(['A', 'B'], 5);
  const tie = E.openingRoll(s, 4, 4);
  assert.equal(tie.phase, 'opening');
  const dark = E.openingRoll(s, 2, 5);
  assert.equal(dark.turn, DARK);
  assert.deepEqual(dark.remaining, [5, 2]);
  assert.equal(dark.phase, 'move');
});

test('destinations chain both dice with one checker', () => {
  const b = E.initialBoard();
  const d = E.destinations(b, LIGHT, [6, 5], 23);
  // 23-5 = 18 is dark's five-checker point, so only the 6 opens the way.
  assert.ok(d.has('17') && !d.has('18') && d.has('12'));
  assert.equal(d.get('12').length, 2);
});

test('destinations do not chain through a blocked intermediate point', () => {
  // From 23 with 1-1: 22 is blocked, so nothing is reachable.
  const b = board({ 23: 1, 22: -2, 5: 14 });
  const d = E.destinations(b, LIGHT, [1, 1, 1, 1], 23);
  assert.equal(d.size, 0);
});

test('random full games never break the rules', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const die = () => 1 + Math.floor(rnd() * 6);
  for (let g = 0; g < 40; g++) {
    let s = E.newMatch(['A', 'B'], 0);
    while (s.phase === 'opening') s = E.openingRoll(s, die(), die());
    let guard = 0;
    while (s.phase === 'move' || s.phase === 'roll') {
      if (s.phase === 'roll') s = E.roll(s, die(), die());
      const moves = E.currentMoves(s);
      if (!moves.length || !s.remaining.length) { s = E.endTurn(s); continue; }
      s = E.play(s, moves[Math.floor(rnd() * moves.length)]);
      const b = s.board;
      for (const p of [LIGHT, DARK]) {
        let n = b.bar[p] + b.off[p];
        for (let i = 0; i < 24; i++) n += E.countAt(b, i, p);
        assert.equal(n, 15);
      }
      assert.ok(++guard < 5000);
    }
    assert.equal(s.phase, 'gameover');
  }
});
