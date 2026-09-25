/*
 * Rules of standard backgammon (обикновена табла), with no doubling cube.
 * Pure: every function takes data and returns new data; nothing here touches
 * the DOM, the clock or Math.random, so the rules can be tested in Node.
 *
 * Board: points[0..23] hold signed counts — positive for LIGHT (player 0),
 * negative for DARK (player 1). LIGHT moves 23 → 0 and bears off below 0;
 * DARK moves 0 → 23 and bears off above 23.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TablaEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIGHT = 0;
  const DARK = 1;
  const BAR = 'bar';
  const OFF = 'off';
  const CHECKERS = 15;

  const sign = (p) => (p === LIGHT ? 1 : -1);

  function initialBoard() {
    const points = new Array(24).fill(0);
    points[23] = 2; points[12] = 5; points[7] = 3; points[5] = 5;
    points[0] = -2; points[11] = -5; points[16] = -3; points[18] = -5;
    return { points, bar: [0, 0], off: [0, 0] };
  }

  function cloneBoard(b) {
    return { points: b.points.slice(), bar: b.bar.slice(), off: b.off.slice() };
  }

  function countAt(board, idx, p) {
    const v = board.points[idx] * sign(p);
    return v > 0 ? v : 0;
  }

  /** Distance of a point from bearing off, as the player counts it (1..24). */
  function pipOf(p, idx) {
    return p === LIGHT ? idx + 1 : 24 - idx;
  }

  function pipCount(board, p) {
    let total = board.bar[p] * 25;
    for (let i = 0; i < 24; i++) total += countAt(board, i, p) * pipOf(p, i);
    return total;
  }

  function allHome(board, p) {
    if (board.bar[p] > 0) return false;
    for (let i = 0; i < 24; i++) {
      if (countAt(board, i, p) && pipOf(p, i) > 6) return false;
    }
    return true;
  }

  function hasFartherThan(board, p, pip) {
    for (let i = 0; i < 24; i++) {
      if (countAt(board, i, p) && pipOf(p, i) > pip) return true;
    }
    return false;
  }

  /** A point is open unless the opponent holds two or more checkers on it. */
  function isOpen(board, idx, p) {
    return board.points[idx] * sign(p) >= -1;
  }

  function makeMove(board, p, from, to, die) {
    const hit = to !== OFF && board.points[to] * sign(p) === -1;
    return { from, to, die, hit };
  }

  /** Every single-checker move for one die, ignoring the whole-turn rules. */
  function singleMoves(board, p, die) {
    const res = [];
    if (board.bar[p] > 0) {
      const to = p === LIGHT ? 24 - die : die - 1;
      if (isOpen(board, to, p)) res.push(makeMove(board, p, BAR, to, die));
      return res;
    }
    const home = allHome(board, p);
    for (let i = 0; i < 24; i++) {
      if (!countAt(board, i, p)) continue;
      const t = p === LIGHT ? i - die : i + die;
      if (t >= 0 && t < 24) {
        if (isOpen(board, t, p)) res.push(makeMove(board, p, i, t, die));
      } else if (home) {
        const pip = pipOf(p, i);
        if (pip === die || (pip < die && !hasFartherThan(board, p, pip))) {
          res.push(makeMove(board, p, i, OFF, die));
        }
      }
    }
    return res;
  }

  function applyMove(board, p, m) {
    const b = cloneBoard(board);
    const s = sign(p);
    if (m.from === BAR) b.bar[p]--;
    else b.points[m.from] -= s;
    if (m.to === OFF) {
      b.off[p]++;
    } else {
      if (b.points[m.to] * s === -1) {
        b.points[m.to] = 0;
        b.bar[1 - p]++;
      }
      b.points[m.to] += s;
    }
    return b;
  }

  function removeDie(dice, die) {
    const i = dice.indexOf(die);
    return dice.slice(0, i).concat(dice.slice(i + 1));
  }

  const uniq = (arr) => Array.from(new Set(arr));

  /** How many of the remaining dice can still be played from here. */
  function maxPlayable(board, p, dice, memo) {
    if (dice.length === 0) return 0;
    const key = board.points.join(',') + '|' + board.bar + '|' + board.off + '|' + dice.slice().sort().join('');
    if (memo.has(key)) return memo.get(key);
    let best = 0;
    for (const die of uniq(dice)) {
      for (const m of singleMoves(board, p, die)) {
        const n = 1 + maxPlayable(applyMove(board, p, m), p, removeDie(dice, die), memo);
        if (n > best) best = n;
        if (best === dice.length) break;
      }
      if (best === dice.length) break;
    }
    memo.set(key, best);
    return best;
  }

  /**
   * Moves that may be played now with the dice still unused. Enforces the
   * whole-turn rules: play as many dice as possible, and if only one of two
   * different dice can be played, play the larger one when it can be.
   */
  function legalMoves(board, p, dice) {
    if (!dice.length) return [];
    const memo = new Map();
    const scored = [];
    let best = 0;
    for (const die of uniq(dice)) {
      for (const m of singleMoves(board, p, die)) {
        const n = 1 + maxPlayable(applyMove(board, p, m), p, removeDie(dice, die), memo);
        scored.push({ m, n });
        if (n > best) best = n;
      }
    }
    let moves = scored.filter((x) => x.n === best).map((x) => x.m);
    if (best === 1 && dice.length === 2 && dice[0] !== dice[1]) {
      const high = Math.max(dice[0], dice[1]);
      if (moves.some((m) => m.die === high)) moves = moves.filter((m) => m.die === high);
    }
    const seen = new Set();
    return moves.filter((m) => {
      const k = m.from + '>' + m.to + ':' + m.die;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /**
   * Every place the checker at `from` can reach this turn, each with the
   * shortest chain of legal moves that gets it there (so one click can use
   * both dice with one checker).
   */
  function destinations(board, p, dice, from) {
    const result = new Map();
    const queue = [{ board, dice, pos: from, path: [] }];
    while (queue.length) {
      const cur = queue.shift();
      for (const m of legalMoves(cur.board, p, cur.dice)) {
        if (m.from !== cur.pos) continue;
        const path = cur.path.concat([m]);
        const key = String(m.to);
        if (!result.has(key)) result.set(key, path);
        else if (result.get(key).length <= path.length) continue;
        if (m.to !== OFF && cur.dice.length > 1) {
          queue.push({ board: applyMove(cur.board, p, m), dice: removeDie(cur.dice, m.die), pos: m.to, path });
        }
      }
    }
    return result;
  }

  /** 1 = обикновена победа, 2 = марс, 3 = бекгамон (двоен марс). */
  function gameResult(board) {
    for (const winner of [LIGHT, DARK]) {
      if (board.off[winner] < CHECKERS) continue;
      const loser = 1 - winner;
      if (board.off[loser] > 0) return { winner, points: 1, kind: 'single' };
      let inWinnersHome = board.bar[loser] > 0;
      for (let i = 0; i < 24; i++) {
        if (countAt(board, i, loser) && pipOf(winner, i) <= 6) inWinnersHome = true;
      }
      return inWinnersHome
        ? { winner, points: 3, kind: 'backgammon' }
        : { winner, points: 2, kind: 'gammon' };
    }
    return null;
  }

  // ---------- game state ----------

  function newMatch(names, matchTo) {
    return {
      players: [{ name: names[0] }, { name: names[1] }],
      matchTo, // 0 = no limit
      score: [0, 0],
      gameNo: 0,
      ...freshGame(),
    };
  }

  function freshGame() {
    return {
      phase: 'opening', // opening | roll | move | gameover | matchover
      board: initialBoard(),
      turn: LIGHT,
      dice: [],
      remaining: [],
      turnSeq: 0,
      openingRoll: null,
      result: null,
    };
  }

  function nextGame(state) {
    return { ...state, ...freshGame(), gameNo: state.gameNo + 1 };
  }

  /** Each player throws one die; the higher one starts with both numbers. */
  function openingRoll(state, lightDie, darkDie) {
    if (lightDie === darkDie) return { ...state, openingRoll: [lightDie, darkDie] };
    const turn = lightDie > darkDie ? LIGHT : DARK;
    const dice = turn === LIGHT ? [lightDie, darkDie] : [darkDie, lightDie];
    return { ...state, openingRoll: [lightDie, darkDie], turn, phase: 'move', dice, remaining: dice.slice(), turnSeq: 1 };
  }

  function roll(state, a, b) {
    const remaining = a === b ? [a, a, a, a] : [a, b];
    return { ...state, phase: 'move', dice: [a, b], remaining };
  }

  function currentMoves(state) {
    if (state.phase !== 'move') return [];
    return legalMoves(state.board, state.turn, state.remaining);
  }

  function play(state, m) {
    const board = applyMove(state.board, state.turn, m);
    const next = { ...state, board, remaining: removeDie(state.remaining, m.die) };
    const result = gameResult(board);
    if (!result) return next;
    const score = state.score.slice();
    score[result.winner] += result.points;
    const matchOver = state.matchTo > 0 && score[result.winner] >= state.matchTo;
    return { ...next, remaining: [], score, result, phase: matchOver ? 'matchover' : 'gameover' };
  }

  function endTurn(state) {
    return { ...state, phase: 'roll', turn: 1 - state.turn, dice: [], remaining: [], turnSeq: state.turnSeq + 1 };
  }

  return {
    LIGHT, DARK, BAR, OFF, CHECKERS,
    initialBoard, cloneBoard, countAt, pipOf, pipCount, allHome,
    singleMoves, applyMove, legalMoves, destinations, gameResult,
    newMatch, nextGame, openingRoll, roll, currentMoves, play, endTurn,
  };
});
