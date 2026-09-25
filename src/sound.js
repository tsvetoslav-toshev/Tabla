/* Every sound is synthesised on the spot — no audio files, nothing to download. */
(function (root) {
  'use strict';
  let ctx = null;
  let noise = null;
  let enabled = true;

  function ac() {
    if (!enabled) return null;
    if (!ctx) {
      const C = root.AudioContext || root.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** A filtered burst of noise: the knock of wood on wood. */
  function knock(c, when, freq, gain, dur, q = 4) {
    const src = c.createBufferSource();
    src.buffer = noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(bp).connect(g).connect(c.destination);
    src.start(when, Math.random() * 0.5, dur + 0.05);
  }

  function tone(c, when, freq, gain, dur, type = 'sine', endFreq) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, when + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(c.destination);
    o.start(when);
    o.stop(when + dur + 0.05);
  }

  root.TablaSound = {
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },
    rattle(ms = 700) {
      const c = ac(); if (!c) return;
      const t = c.currentTime;
      const n = 9;
      for (let i = 0; i < n; i++) {
        const at = t + (ms / 1000) * (i / n) * (0.85 + Math.random() * 0.3);
        knock(c, at, 1800 + Math.random() * 2200, 0.18 * (1 - i / (n * 1.4)), 0.04);
      }
    },
    land() {
      const c = ac(); if (!c) return;
      const t = c.currentTime;
      knock(c, t, 900, 0.35, 0.07, 3);
      knock(c, t + 0.06, 1300, 0.12, 0.05, 3);
    },
    checker() {
      const c = ac(); if (!c) return;
      const t = c.currentTime;
      knock(c, t, 1500, 0.4, 0.05, 5);
      tone(c, t, 220, 0.12, 0.08, 'sine', 140);
    },
    hit() {
      const c = ac(); if (!c) return;
      const t = c.currentTime;
      knock(c, t, 1100, 0.6, 0.08, 3);
      knock(c, t + 0.05, 2000, 0.25, 0.05, 4);
      tone(c, t, 160, 0.2, 0.18, 'triangle', 90);
    },
    off() {
      const c = ac(); if (!c) return;
      const t = c.currentTime;
      knock(c, t, 700, 0.2, 0.06, 2);
      tone(c, t, 520, 0.08, 0.25, 'sine', 780);
    },
    tap() {
      const c = ac(); if (!c) return;
      tone(c, c.currentTime, 660, 0.05, 0.06, 'sine');
    },
    error() {
      const c = ac(); if (!c) return;
      const t = c.currentTime;
      tone(c, t, 240, 0.08, 0.12, 'triangle');
      tone(c, t + 0.1, 190, 0.08, 0.16, 'triangle');
    },
    win(big) {
      const c = ac(); if (!c) return;
      const t = c.currentTime;
      const notes = big ? [523, 659, 784, 1047, 1319] : [523, 659, 784, 1047];
      notes.forEach((f, i) => {
        tone(c, t + i * 0.11, f, 0.12, 0.5, 'triangle');
        tone(c, t + i * 0.11, f * 2, 0.03, 0.35, 'sine');
      });
    },
  };
})(typeof window !== 'undefined' ? window : this);
