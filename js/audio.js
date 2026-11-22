// Browser audio for the chat: one microphone feeding two receivers
// (ultrasonic and audible, so people on either setting hear each other),
// scheduled playback of frames, and a "someone is talking" signal.
import { ULTRASONIC, AUDIBLE } from './modem.js';

export const FRAME_PAUSE = 0.06;

/** Sending modes offered in the app. */
export const PROFILES = {
  silent: { modem: ULTRASONIC, mode: ULTRASONIC.MODES[1] }, // 18–20 kHz
  'silent-far': { modem: ULTRASONIC, mode: ULTRASONIC.MODES[0] }, // 18–20 kHz, slower and sturdier
  audible: { modem: AUDIBLE, mode: AUDIBLE.MODES[1] }, // 1.5–7 kHz, for phones that cannot do ultrasound
};

export function frameTime(profile) {
  const { modem, mode } = PROFILES[profile];
  return (modem.frameDuration(mode) + FRAME_PAUSE) * 1000;
}

const TAP_SRC = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(1024);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('tap', Tap);
`;

function audioSession(type) {
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch { /* unsupported */ }
}

export const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export class ChatAudio {
  /**
   * onFrame(content, { profile, quality }), onActivity() for frames heard but
   * not decoded, onLevel(rms) for the meter.
   */
  constructor({ onFrame = () => {}, onActivity = () => {}, onLevel = () => {} } = {}) {
    this.h = { onFrame, onActivity, onLevel };
    this.mic = null;
    this.out = null;
    this.gain = null;
    this.volume = 0.8;
    this.lastSync = -Infinity;
    // iOS lowers or reroutes the speaker while the microphone records.
    this.muteWhileSending = isIOS;
    this.sending = false;
    this.wantMic = false;
  }

  async start() {
    this.wantMic = true;
    await this._ensureOut();
    await this._micOn();
  }

  stop() {
    this.wantMic = false;
    this._micOff();
  }

  /** After the page was hidden: resume suspended audio, reopen a microphone the system stopped. */
  async wake() {
    if (!this.wantMic) return;
    const m = this.mic;
    const dead = m && (m.stream.getAudioTracks().every((t) => t.readyState === 'ended') || m.ctx.state === 'closed');
    if (dead) this._micOff();
    else if (m && m.ctx.state !== 'running') await m.ctx.resume();
    if (this.out && this.out.state !== 'running') await this.out.resume();
    if (!this.mic && !this.sending) await this._micOn();
  }

  async _ensureOut() {
    if (!this.out) {
      this.out = new AudioContext({ latencyHint: 'interactive' });
      this.gain = this.out.createGain();
      this.gain.connect(this.out.destination);
    }
    this.gain.gain.value = this.volume;
    await this.out.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
  }

  async _micOn() {
    if (this.mic) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-mic-api');
    audioSession('play-and-record');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    let ctx = new AudioContext();
    let src;
    try {
      src = ctx.createMediaStreamSource(stream);
    } catch {
      await ctx.close(); // Firefox: the context must run at the microphone's rate
      ctx = new AudioContext({ sampleRate: stream.getAudioTracks()[0].getSettings().sampleRate });
      src = ctx.createMediaStreamSource(stream);
    }
    await ctx.resume();
    const sr = ctx.sampleRate;
    const handlers = (profile) => ({
      onFrame: (f) => this.h.onFrame(f.content, { profile, quality: f.quality }),
      onEvent: (e) => {
        if (e.type === 'sync') this.lastSync = performance.now();
        else if (e.type === 'fail' && e.reason === 'decode') this.h.onActivity();
      },
    });
    // Ultrasound is checked often (small blocks) so listen-before-talk reacts fast.
    const rxU = new ULTRASONIC.Receiver(sr, { ...handlers('silent'), block: 2048 });
    const rxA = new AUDIBLE.Receiver(sr, { ...handlers('audible'), block: 4096 });
    const onSamples = (x) => {
      let s = 0;
      for (let i = 0; i < x.length; i++) s += x[i] * x[i];
      this.h.onLevel(Math.sqrt(s / x.length));
      rxU.push(x);
      rxA.push(x);
    };
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    let node;
    if (ctx.audioWorklet) {
      const url = URL.createObjectURL(new Blob([TAP_SRC], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      node = new AudioWorkletNode(ctx, 'tap');
      node.port.onmessage = (e) => onSamples(e.data);
    } else {
      node = ctx.createScriptProcessor(2048, 1, 1);
      node.onaudioprocess = (e) => onSamples(new Float32Array(e.inputBuffer.getChannelData(0)));
    }
    src.connect(node);
    node.connect(sink);
    this.mic = { stream, ctx, src, node, rxU, rxA, sr };
  }

  _micOff() {
    const m = this.mic;
    if (!m) return;
    this.mic = null;
    try { m.src.disconnect(); m.node.disconnect(); } catch { /* ignore */ }
    m.stream.getTracks().forEach((t) => t.stop());
    m.ctx.close();
    this.h.onLevel(0);
  }

  get micOn() {
    return !!this.mic;
  }

  /** Someone is transmitting (a frame is being received, or a chirp was just heard). */
  busy() {
    const m = this.mic;
    return !!m && (m.rxU.busy || m.rxA.busy || performance.now() - this.lastSync < 400);
  }

  /** Plays frames back to back in a profile; resolves when the last one has finished. */
  async transmit(frames, profile, { keepMic = false } = {}) {
    const { modem, mode } = PROFILES[profile];
    this.sending = true;
    const mute = this.muteWhileSending && !keepMic && this.mic;
    try {
      if (mute) this._micOff();
      audioSession(mute ? 'playback' : 'play-and-record');
      await this._ensureOut();
      const ctx = this.out;
      const sr = ctx.sampleRate;
      let t = ctx.currentTime + 0.05;
      for (const content of frames) {
        const samples = modem.modulate(content, mode, sr);
        const buf = ctx.createBuffer(1, samples.length, sr);
        buf.copyToChannel(samples, 0);
        const s = ctx.createBufferSource();
        s.buffer = buf;
        s.connect(this.gain);
        s.start(t);
        t += modem.frameDuration(mode) + FRAME_PAUSE;
      }
      const ms = (t - ctx.currentTime) * 1000;
      await new Promise((r) => setTimeout(r, Math.max(0, ms)));
    } finally {
      this.sending = false;
      if (mute && this.wantMic) {
        try { await this._micOn(); } catch { /* permission lost */ }
      }
    }
  }
}
