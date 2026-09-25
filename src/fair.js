/*
 * Fair dice online: both browsers take part in every throw, so neither can
 * choose the numbers.
 *
 *   1. The host picks a secret seed and sends only its fingerprint (SHA-256).
 *   2. The guest answers with a seed of its own, in the open.
 *   3. At the throw the host reveals its seed; the dice come from both seeds.
 *
 * The host cannot change its seed after seeing the guest's (the fingerprint
 * would not match), and the guest does not know the host's seed when it picks
 * its own. The guest's screen checks both before showing the dice.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TablaFair = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  function utf8(str) {
    return typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(str)
      : Uint8Array.from(unescape(encodeURIComponent(str)), (c) => c.charCodeAt(0));
  }

  /** SHA-256 of a string, as 32 bytes. Small and synchronous, so it works from file:// too. */
  function sha256(str) {
    const msg = utf8(str);
    const len = msg.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(msg);
    buf[len] = 0x80;
    const bits = len * 8;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
    dv.setUint32(total - 4, bits >>> 0);
    const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + maj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    h.forEach((v, i) => odv.setUint32(i * 4, v));
    return out;
  }

  const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  /** The fingerprint the host sends before the throw. */
  const fingerprint = (seed) => hex(sha256('tabla-seed|' + seed));

  /** Two dice from both seeds; every number equally likely (no modulo bias). */
  function diceFrom(hostSeed, guestSeed) {
    let bytes = sha256('tabla-dice|' + hostSeed + '|' + guestSeed);
    const dice = [];
    for (;;) {
      for (const b of bytes) {
        if (b < 252) dice.push((b % 6) + 1); // 252 = 6 * 42
        if (dice.length === 2) return dice;
      }
      bytes = sha256(hex(bytes));
    }
  }

  function newSeed(randomBytes) {
    const a = new Uint8Array(16);
    randomBytes(a);
    return hex(a);
  }

  /** What the guest checks before it believes a throw. */
  function verify({ commit, hostSeed, guestSeed, dice, myGuestSeed }) {
    if (typeof hostSeed !== 'string' || typeof guestSeed !== 'string') return false;
    if (fingerprint(hostSeed) !== commit) return false;
    if (myGuestSeed && myGuestSeed !== guestSeed) return false;
    const d = diceFrom(hostSeed, guestSeed);
    return Array.isArray(dice) && d[0] === dice[0] && d[1] === dice[1];
  }

  return { sha256, hex, fingerprint, diceFrom, newSeed, verify };
});
