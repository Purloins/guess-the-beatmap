// Synthesized osu!-style hitsounds (Web Audio), so no sound files are needed.
let ac = null, master = null, noiseBuf = null;

export function unlockAudio() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
export const audioNow = () => (ac ? ac.currentTime : 0);
export const ready = () => !!ac && ac.state === 'running';

function noise(at, dur, type, freq, q, vol) {
  const s = ac.createBufferSource(); s.buffer = noiseBuf;
  const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain(); g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  s.connect(f); f.connect(g); g.connect(master);
  s.start(at, Math.random() * 0.5); s.stop(at + dur + 0.02);
}
function tone(at, dur, type, f0, f1, vol) {
  const o = ac.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + dur);
  const g = ac.createGain(); g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + dur);
  o.connect(g); g.connect(master); o.start(at); o.stop(at + dur + 0.02);
}

// hs bits: 2 whistle, 4 finish, 8 clap. Normal always plays.
export function play(ev, at) {
  if (!ac) return;
  const v = Math.max(0.15, ev.vol ?? 1);
  if (ev.tick) { tone(at, 0.03, 'sine', 2600, 2400, 0.12 * v); return; }
  noise(at, 0.035, 'bandpass', 3800, 1.2, 0.55 * v);          // crisp "tick" of the normal hit
  tone(at, 0.05, 'triangle', 820, 520, 0.35 * v);             // body
  if (ev.hs & 2) tone(at, 0.14, 'sine', 1250, 1650, 0.22 * v); // whistle
  if (ev.hs & 8) { noise(at, 0.09, 'bandpass', 1500, 0.9, 0.7 * v); noise(at + 0.012, 0.08, 'bandpass', 1900, 0.9, 0.5 * v); } // clap
  if (ev.hs & 4) noise(at, 0.7, 'highpass', 5500, 0.7, 0.45 * v); // finish (cymbal)
}
