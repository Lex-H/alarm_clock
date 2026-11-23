/*
 * audio.js — Web Audio alarm sounds (one timbre per art style) and
 * pre-scheduled "sound sessions". Exposed as window.TimerAudio.
 */
(function (root) {
  'use strict';

  let ctx = null, master = null;

  // Create / resume the AudioContext. Call inside a user gesture to unlock audio.
  function ensure() {
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.7;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    // Play a 1-sample silent buffer inside the gesture to unlock audio (iOS/Safari).
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination); src.start(0);
    return ctx;
  }
  const hasContext = () => !!ctx;
  const isReady = () => !!ctx && ctx.state === 'running';
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  function tone(dest, t, { f, dur, type = 'sine', vol = 0.3, att = 0.005, f2 = null }) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // Each sound schedules one pattern at time t and returns the pattern period (seconds).
  const SOUNDS = {
    flip(dest, t) { // mechanical bell trill
      for (let i = 0; i < 10; i++) {
        const tt = t + i * 0.045;
        tone(dest, tt, { f: 2093, dur: 0.04, type: 'square', vol: 0.05, att: 0.002 });
        tone(dest, tt, { f: 1568, dur: 0.042, type: 'triangle', vol: 0.16, att: 0.002 });
      }
      return 0.95;
    },
    neon(dest, t) { // saw arpeggio through a sweeping lowpass
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 9;
      lp.frequency.setValueAtTime(600, t);
      lp.frequency.exponentialRampToValueAtTime(6000, t + 0.85);
      lp.connect(dest);
      const notes = [440, 554.37, 659.25, 880, 1108.73, 1318.51, 1760, 1318.51];
      notes.forEach((n, i) => tone(lp, t + i * 0.11, { f: n, dur: 0.1, type: 'sawtooth', vol: 0.16, att: 0.004 }));
      return 1.15;
    },
    washi(dest, t) { // singing bowl: inharmonic partials, long decay, slight beating
      const base = 392;
      [[1, 0.26, 3.6], [2.71, 0.12, 2.8], [5.13, 0.05, 1.8], [8.3, 0.025, 1.1]].forEach(([r, v, d]) => {
        tone(dest, t, { f: base * r, dur: d, vol: v, att: 0.008 });
        tone(dest, t, { f: base * r + 1.7, dur: d, vol: v * 0.6, att: 0.008 });
      });
      return 2.3;
    },
    glass(dest, t) { // soft ding-dong
      tone(dest, t, { f: 1318.51, dur: 0.75, vol: 0.3 });
      tone(dest, t, { f: 2637.02, dur: 0.3, vol: 0.05 });
      tone(dest, t + 0.36, { f: 987.77, dur: 0.95, vol: 0.3 });
      tone(dest, t + 0.36, { f: 1975.53, dur: 0.3, vol: 0.05 });
      return 1.55;
    },
    arcade(dest, t) { // chiptune jingle
      const mel = [[659.25, 0.1], [783.99, 0.1], [1046.5, 0.1], [1318.51, 0.1], [1046.5, 0.1], [1318.51, 0.24]];
      let x = t;
      mel.forEach(([f, d]) => { tone(dest, x, { f, dur: d * 0.9, type: 'square', vol: 0.09, att: 0.002 }); x += d; });
      return (x - t) + 0.36;
    },
  };
  const play = (name, dest, t) => (SOUNDS[name] || SOUNDS.neon)(dest, t);

  // A sound session pre-schedules ~40 s of ringing on the audio clock, so it fires on
  // time even when the tab is in the background and JS timers are throttled.
  // getTheme() is read on every pattern so a style change re-voices future patterns.
  function makeSound(getTheme) {
    return {
      s: null,
      arm(delaySec) {
        if (!ctx) return;
        this.disarm();
        const g = ctx.createGain();
        g.connect(master);
        this.s = { g, next: ctx.currentTime + Math.max(0.05, delaySec) };
        this.fill(this.s.next + 40);
      },
      fill(until) {
        const s = this.s;
        if (!s) return;
        let guard = 0;
        while (s.next < until && guard++ < 300) s.next += play(getTheme(), s.g, s.next);
      },
      keep() { if (ctx && this.s) this.fill(ctx.currentTime + 3); },
      disarm() {
        if (this.s) { try { this.s.g.disconnect(); } catch (e) { /* ignore */ } this.s = null; }
      },
    };
  }

  // One short pattern, used when the user picks a style.
  function preview(name) {
    if (!isReady()) return;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    g.connect(master);
    play(name, g, ctx.currentTime + 0.02);
    setTimeout(() => { try { g.disconnect(); } catch (e) { /* ignore */ } }, 2600);
  }

  root.TimerAudio = { ensure, hasContext, isReady, resume, makeSound, preview };
})(window);
