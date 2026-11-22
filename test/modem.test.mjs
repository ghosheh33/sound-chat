// Ultrasonic modem: decoding through simulated channels, and how much energy
// leaks below 17 kHz (what a person could hear as clicks).
import { ULTRASONIC as U, AUDIBLE as A } from '../js/modem.js';
import { FFT } from '../js/fft.js';
import assert from 'node:assert/strict';

let seed = 11;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

/**
 * Band-limited resampling (Lanczos-windowed sinc, 16 taps each side).
 * Linear interpolation is not good enough near 19 kHz: as the fractional
 * offset drifts it amplitude-modulates the tones, which real sound does not.
 */
export function resample(x, ratio, cutoff = 1) {
  const A = 16;
  const n = Math.floor(x.length / ratio);
  const y = new Float32Array(n);
  const c = cutoff * 0.97;
  for (let i = 0; i < n; i++) {
    const t = i * ratio;
    const k0 = Math.floor(t);
    let acc = 0;
    for (let k = k0 - A + 1; k <= k0 + A; k++) {
      if (k < 0 || k >= x.length) continue;
      const d = t - k;
      const sinc = d === 0 ? 1 : Math.sin(Math.PI * c * d) / (Math.PI * d);
      const win = Math.abs(d) < A ? (d === 0 ? 1 : Math.sin((Math.PI * d) / A) / ((Math.PI * d) / A)) : 0;
      acc += x[k] * sinc * win;
    }
    y[i] = acc;
  }
  return y;
}

function channel(x, { srIn, srOut, drift = 0, snrDb, reverb = 0, gain = 0.05 }) {
  const ratio = (srIn / srOut) * (1 + drift); // drift also models Doppler (moving phone)
  let y = resample(x, ratio, Math.min(1, 1 / ratio));
  const n = y.length;
  if (reverb) {
    const L = Math.round(0.15 * srOut);
    const out = new Float32Array(n + L);
    const taps = [[0, 1], [Math.round(0.0023 * srOut), 0.45], [Math.round(0.0071 * srOut), -0.3]];
    const amp = Math.sqrt(reverb / (0.02 * srOut));
    for (let i = Math.round(0.008 * srOut); i < L; i += 23) taps.push([i, amp * Math.sqrt(23) * gauss() * Math.exp(-i / (0.04 * srOut))]);
    for (let i = 0; i < n; i++) { const v = y[i]; if (v) for (const [d, g] of taps) out[i + d] += v * g; }
    y = out;
  }
  let p = 0, c = 0;
  for (const v of y) if (v) { p += v * v; c++; }
  const sigma = Math.sqrt(p / c / 10 ** (snrDb / 10));
  // weak speaker at 19 kHz: small gain, then the microphone's own noise
  for (let i = 0; i < y.length; i++) y[i] = gain * (y[i] + sigma * gauss());
  return y;
}

function run(M, mode, cfg, frames = 10) {
  const parts = [new Float32Array(cfg.srIn * 0.5)];
  const sent = [];
  for (let i = 0; i < frames; i++) {
    const c = Uint8Array.from({ length: mode.content }, () => (rnd() * 256) | 0);
    sent.push(c);
    parts.push(M.modulate(c, mode, cfg.srIn), new Float32Array(Math.round(cfg.srIn * 0.1)));
  }
  parts.push(new Float32Array(cfg.srIn));
  const tx = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { tx.set(p, o); o += p.length; }
  const rx = channel(tx, cfg);
  let ok = 0;
  const r = new M.Receiver(cfg.srOut, {
    onFrame: (f) => { if (sent.some((s) => s.every((v, j) => v === f.content[j]))) ok++; },
  });
  for (let i = 0; i < rx.length; i += 2048) r.push(rx.subarray(i, i + 2048));
  return ok;
}

const scenarios = [
  { name: 'clean 48k', srIn: 48000, srOut: 48000, snrDb: 30 },
  { name: '48k -> 44.1k', srIn: 48000, srOut: 44100, snrDb: 20 },
  { name: 'room, 15 dB', srIn: 44100, srOut: 48000, snrDb: 15, reverb: 0.3 },
  { name: 'room + phone moving', srIn: 48000, srOut: 48000, snrDb: 15, reverb: 0.3, drift: 3e-4 },
  { name: 'moving away, 44.1k', srIn: 48000, srOut: 44100, snrDb: 15, reverb: 0.3, drift: -4e-4 },
  { name: 'far, 8 dB', srIn: 48000, srOut: 48000, snrDb: 8, reverb: 0.3 },
];
let failed = false;
for (const mode of U.MODES) {
  for (const sc of scenarios) {
    const ok = run(U, mode, sc);
    const need = sc.snrDb < 10 && mode.key !== 'u-robust' ? 0 : 10;
    if (ok < need) failed = true;
    console.log(`${mode.key.padEnd(9)} | ${sc.name.padEnd(20)} | ${ok}/10`);
  }
}

// Audible leakage: energy below 17 kHz relative to the whole frame.
function leakDb(samples, sr) {
  const N = 1 << Math.ceil(Math.log2(samples.length));
  const fft = new FFT(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  re.set(samples);
  fft.transform(re, im);
  let low = 0, all = 0;
  for (let k = 1; k < N / 2; k++) {
    const e = re[k] ** 2 + im[k] ** 2;
    all += e;
    if ((k * sr) / N < 17000) low += e;
  }
  return 10 * Math.log10(low / all);
}
for (const mode of U.MODES) {
  const s = U.modulate(new Uint8Array(mode.content).map((_, i) => i * 7), mode, 48000);
  const l = leakDb(s, 48000);
  console.log(`${mode.key.padEnd(9)} | energy below 17 kHz: ${l.toFixed(1)} dB`);
  if (l > -35) failed = true;
}
// Audible profile still works through the same code path.
assert.equal(run(A, A.MODES[1], scenarios[1]), 10);
assert.ok(!failed, 'modem scenarios failed');
console.log('modem: ok');
