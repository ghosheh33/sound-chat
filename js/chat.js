// Group chat over a shared acoustic channel (no network).
//
// Frame content (fills the modem frame, zero padded):
//   [0] 0xC0 | type     [1..2] sender id     [3] room     [4] payload length
//   [5..] payload
// Types:
//   HELLO  flags(1) | name length(1) | name        presence, sent on join,
//                                                  every ~50 s, and as a reply
//   MSG    message id(2) | part(1) | parts(1) | frames left in this burst(1) | UTF-8 text chunk
//          (frames left lets every listener know when the burst ends, even if
//          it misses the last frame)
//   ACK    count(1) | (to id(2), message id(2), missing parts mask(2)) × count
//          mask 0 = received in full; otherwise the parts to send again
//   BYE    —                                        leaving
//
// Everyone hears everyone, so the room's participants are the devices heard
// recently. Messages are acknowledged by every receiver; the sender resends
// up to twice to those who did not confirm. The medium is shared and half
// duplex, so a device waits for silence and a random back-off before it talks.

export const TYPE = { HELLO: 1, MSG: 2, ACK: 3, BYE: 4 };
const HEADER = 5;
const MAGIC = 0xc0;
export const MAX_TEXT = 400; // bytes of UTF-8 per message
export const MAX_PARTS = 16; // one bit per part in an ACK's missing mask
const ACK_ENTRY = 6;
const MSG_HEAD = 5;
export const PEER_TIMEOUT = 150000; // ms without hearing someone before they are gone
const HELLO_EVERY = [40000, 60000];
const HELLO_EARLY = [15000, 25000]; // during the first two minutes, to find everyone quickly
const HELLO_REPLY = [500, 9000]; // replies to a newcomer are spread so they do not collide
const ACK_START = 900; // ms after a message before the first acknowledgement slot (time for a phone to switch its microphone back on)
// Random back-off after the channel goes quiet, by priority: a missed ack
// slot first, then messages, then presence.
const BACKOFF = { ack: [100, 1200], msg: [200, 2500], hello: [500, 6000], bye: [100, 800] };
const RETRIES = 6;
const HANGOVER = 1000; // ms after the last frame heard during which the channel counts as busy
const enc = new TextEncoder();
const dec = new TextDecoder();
const rand = (a, b) => a + Math.random() * (b - a);

export function makeFrame(size, type, from, room, payload = new Uint8Array(0)) {
  const c = new Uint8Array(size);
  c[0] = MAGIC | type;
  c[1] = from >> 8; c[2] = from & 0xff;
  c[3] = room;
  c[4] = payload.length;
  c.set(payload, HEADER);
  return c;
}

export function parse(content) {
  if ((content[0] & 0xf0) !== MAGIC) return null;
  const type = content[0] & 0x0f;
  const len = content[4];
  if (HEADER + len > content.length) return null;
  const p = content.subarray(HEADER, HEADER + len);
  const f = { type, from: (content[1] << 8) | content[2], room: content[3] };
  switch (type) {
    case TYPE.HELLO:
      if (len < 2 || 2 + p[1] > len) return null;
      return { ...f, wantReply: !!(p[0] & 1), name: dec.decode(p.subarray(2, 2 + p[1])) };
    case TYPE.MSG:
      if (len < MSG_HEAD || p[3] === 0 || p[3] > MAX_PARTS || p[2] >= p[3]) return null;
      return { ...f, msgId: (p[0] << 8) | p[1], part: p[2], parts: p[3], left: p[4], chunk: p.slice(MSG_HEAD) };
    case TYPE.ACK: {
      const n = p[0];
      if (len < 1 + n * ACK_ENTRY) return null;
      const acks = [];
      for (let i = 0; i < n; i++) {
        const o = 1 + i * ACK_ENTRY;
        acks.push({ to: (p[o] << 8) | p[o + 1], msgId: (p[o + 2] << 8) | p[o + 3], missing: (p[o + 4] << 8) | p[o + 5] });
      }
      return { ...f, acks };
    }
    case TYPE.BYE:
      return f;
    default:
      return null;
  }
}

function truncUtf8(str, max) {
  let out = new Uint8Array(0);
  let acc = '';
  for (const ch of str) {
    const next = enc.encode(acc + ch);
    if (next.length > max) break;
    acc += ch;
    out = next;
  }
  return out;
}

/** Splits UTF-8 bytes into chunks without cutting a character in two. */
function chunks(bytes, size) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    let end = Math.min(bytes.length, i + size);
    while (end < bytes.length && end > i && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(bytes.subarray(i, end));
    i = end;
  }
  return out.length ? out : [new Uint8Array(0)];
}

/**
 * io: {
 *   frameSize            bytes of content per frame (depends on the chosen mode)
 *   frameTime            ms one frame occupies on air, pause included
 *   transmit(frames)     plays frames back to back, resolves when done
 *   busy()               true while someone else is talking
 * }
 * clock: { now(), setTimeout(fn, ms), clearTimeout(t) }
 * onEvent({ type: 'peers' | 'message' | 'update' | 'tx', ... })
 */
export class ChatNode {
  constructor({ id, name, room = 0, io, clock, onEvent = () => {} }) {
    this.id = id;
    this.name = name;
    this.room = room;
    this.io = io;
    this.clock = clock;
    this.onEvent = onEvent;
    this.peers = new Map(); // id -> { name, lastSeen }
    this.messages = []; // shown in the conversation
    this.partial = new Map(); // `${from}:${msgId}` -> { parts: [], name, time }
    this.delivered = new Set(); // `${from}:${msgId}` already shown
    this.queue = []; // { kind, frames, msg? }
    this.pendingAcks = new Map(); // `${to}:${msgId}` -> { to, msgId, missing }
    this.responses = new Map(); // `${from}:${msgId}` -> timer answering when the burst ends
    this.nextMsgId = (Math.random() * 65536) | 0;
    this.lastHelloReply = -Infinity;
    this.running = false;
    this.txActive = false;
    this.timers = new Set();
    this.lastHeard = -Infinity;
    this.reservedUntil = -Infinity; // acknowledgement slots in progress
  }

  /** One acknowledgement slot: a frame plus room for detection and jitter. */
  get slot() {
    return this.io.frameTime + 400;
  }

  /** Reserve the acknowledgement slots that follow a message from `sender`. */
  _reserve(sender, now) {
    const others = [...this.peers.keys(), this.id].filter((id) => id !== sender);
    this.reservedUntil = Math.max(this.reservedUntil, now + ACK_START + others.length * this.slot);
    return others.sort((a, b) => a - b);
  }

  /** Someone else is talking, or was a moment ago (gaps between frames of one message). */
  channelBusy() {
    return this.io.busy() || this.clock.now() - this.lastHeard < HANGOVER;
  }

  // ---------- timers ----------
  _after(ms, fn) {
    const t = this.clock.setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }

  _sleep(ms) {
    return new Promise((r) => this._after(ms, r));
  }

  // ---------- lifecycle ----------
  start() {
    this.running = true;
    this.startedAt = this.clock.now();
    this.sendHello(true);
    // ask once more: some replies to the first request may have collided
    this._after(rand(14000, 20000), () => { if (this.running) this.sendHello(true); });
    this._scheduleHello();
    this._after(5000, () => this._prune());
  }

  async stop() {
    if (!this.running) return;
    // twice, as two separate transmissions, so one collision cannot take both
    this.queue = [this._job('bye', [this._frame(TYPE.BYE)]), this._job('bye', [this._frame(TYPE.BYE)])];
    this.running = false;
    this.stopping = true;
    this.reservedUntil = -Infinity;
    this._pump(); // a loop already running (waiting to talk) picks the BYEs up instead
    for (let i = 0; i < 300 && (this.queue.length || this.txActive); i++) await this._sleep(100);
    this.stopping = false;
    for (const t of this.timers) this.clock.clearTimeout(t);
    this.timers.clear();
  }

  setName(name) {
    this.name = name;
    if (this.running) this.sendHello(false);
  }

  _scheduleHello() {
    const early = this.clock.now() - this.startedAt < 120000;
    this._after(rand(...(early ? HELLO_EARLY : HELLO_EVERY)), () => {
      if (!this.running) return;
      this.sendHello(false);
      this._scheduleHello();
    });
  }

  _prune() {
    if (!this.running) return;
    const now = this.clock.now();
    let changed = false;
    for (const [id, p] of this.peers) {
      if (now - p.lastSeen > PEER_TIMEOUT) { this.peers.delete(id); changed = true; }
    }
    if (changed) this._peersChanged();
    this._after(5000, () => this._prune());
  }

  /** Active participants other than me. */
  activePeers() {
    return [...this.peers.entries()].map(([id, p]) => ({ id, ...p }));
  }

  /** People in the conversation, including me. */
  count() {
    return this.peers.size + 1;
  }

  _peersChanged() {
    this.onEvent({ type: 'peers', peers: this.activePeers(), count: this.count() });
  }

  // ---------- sending ----------
  _frame(type, payload) {
    return makeFrame(this.io.frameSize, type, this.id, this.room, payload);
  }

  _job(kind, frames, extra = {}) {
    return { kind, frames, ...extra };
  }

  sendHello(wantReply) {
    const name = truncUtf8(this.name, Math.min(24, this.io.frameSize - HEADER - 2));
    const p = new Uint8Array(2 + name.length);
    p[0] = wantReply ? 1 : 0;
    p[1] = name.length;
    p.set(name, 2);
    this.queue = this.queue.filter((j) => j.kind !== 'hello');
    this._enqueue(this._job('hello', [this._frame(TYPE.HELLO, p)]));
  }

  /** Sends a text message to everyone in the room. Returns the message object. */
  send(text) {
    const bytes = truncUtf8(text, MAX_TEXT);
    const msgId = this.nextMsgId = (this.nextMsgId + 1) & 0xffff;
    const parts = chunks(bytes, this.io.frameSize - HEADER - MSG_HEAD);
    if (parts.length > MAX_PARTS) throw new Error('too long');
    const msg = {
      key: `${this.id}:${msgId}`, msgId, from: this.id, name: this.name, mine: true,
      text: dec.decode(bytes), time: this.clock.now(), status: 'queued',
      expected: new Map(this.activePeers().map((p) => [p.id, p.name])), ackedBy: new Map(), tries: 0,
      parts,
    };
    this.messages.push(msg);
    this.onEvent({ type: 'message', msg });
    this._enqueue(this._job('msg', [], { msg }));
    return msg;
  }

  /** Frames of one burst: the given parts, each saying how many frames follow it. */
  _msgFrames(msg, indices) {
    return indices.map((i, k) => {
      const c = msg.parts[i];
      const p = new Uint8Array(MSG_HEAD + c.length);
      p[0] = msg.msgId >> 8; p[1] = msg.msgId & 0xff; p[2] = i; p[3] = msg.parts.length;
      p[4] = indices.length - 1 - k;
      p.set(c, MSG_HEAD);
      return this._frame(TYPE.MSG, p);
    });
  }

  _enqueue(job) {
    if (job.kind === 'ack') this.queue.unshift(job); // acks first: they are short and others wait for them
    else this.queue.push(job);
    this._pump();
  }

  /** Next job allowed to go now: acknowledgements in their slot, others after the slots. */
  _nextJob(now) {
    const ack = this.queue.findIndex((j) => j.kind === 'ack' && !j.late && j.at <= now);
    if (ack >= 0) return this.queue.splice(ack, 1)[0];
    if (now < this.reservedUntil) return null;
    const late = this.queue.findIndex((j) => j.kind === 'ack' && j.late);
    if (late >= 0) return this.queue.splice(late, 1)[0];
    const i = this.queue.findIndex((j) => j.kind !== 'ack');
    return i >= 0 ? this.queue.splice(i, 1)[0] : null;
  }

  /** Back-off window; it doubles with each failed attempt of a message (exponential back-off). */
  _window(job) {
    const [lo, hi] = BACKOFF[job.kind] || BACKOFF.msg;
    const tries = job.msg ? job.msg.tries : 0;
    return [lo, Math.min(16000, hi * 2 ** tries)];
  }

  _ackDue() {
    const now = this.clock.now();
    return this.queue.some((j) => j.kind === 'ack' && !j.late && j.at <= now);
  }

  /**
   * Listen before talk with a frozen back-off (as in Wi-Fi): draw a random
   * wait once, count it down only while the channel is quiet and no ack
   * slots are reserved, pause it while someone talks, and go when it runs
   * out. Unlike starting over, this guarantees that everyone gets a turn.
   * Returns false if one of our ack slots came due (it has priority).
   */
  async _contend([lo, hi]) {
    let left = rand(lo, hi);
    for (let guard = 0; guard < 5000; guard++) {
      if (this._ackDue()) return false;
      const now = this.clock.now();
      if (this.channelBusy() || now < this.reservedUntil) {
        await this._sleep(Math.min(200, Math.max(20, this.reservedUntil - now)));
        continue;
      }
      if (left <= 0) return true;
      const step = Math.min(100, left);
      await this._sleep(step);
      if (!this.channelBusy()) left -= step;
    }
    return true;
  }

  /** Transmits queued jobs one by one: listen before talk, random back-off, reserved ack slots. */
  async _pump() {
    if (this.txActive) return;
    this.txActive = true;
    try {
      while (this.queue.length && (this.running || this.stopping)) {
        const now = this.clock.now();
        const waitAck = this.queue.filter((j) => j.kind === 'ack').map((j) => j.at);
        const peek = this.queue.find((j) => (j.kind === 'ack' && !j.late ? j.at <= now : now >= this.reservedUntil));
        if (!peek) {
          // nothing may go yet: sleep until the next ack slot or the end of the reservation
          const next = Math.min(...waitAck, this.reservedUntil > now ? this.reservedUntil : Infinity);
          await this._sleep(Math.max(50, Math.min(2000, (isFinite(next) ? next : now + 500) - now)));
          continue;
        }
        if (peek.kind === 'ack' && !peek.late) {
          // our slot: someone is in it (views of the room differ) -> give it up and contend later
          if (this.io.busy()) {
            peek.late = true;
            continue;
          }
        } else if (!(await this._contend(this._window(peek)))) {
          continue; // an ack slot came due while waiting: it goes first
        }
        const job = this._nextJob(this.clock.now());
        if (!job) continue;
        if (job.kind === 'ack') {
          const list = [...this.pendingAcks.values()].slice(0, Math.floor((this.io.frameSize - HEADER - 1) / ACK_ENTRY));
          if (!list.length) continue;
          list.forEach((a) => this.pendingAcks.delete(`${a.to}:${a.msgId}`));
          const p = new Uint8Array(1 + list.length * ACK_ENTRY);
          p[0] = list.length;
          list.forEach((a, i) => {
            const o = 1 + i * ACK_ENTRY;
            p[o] = a.to >> 8; p[o + 1] = a.to & 0xff;
            p[o + 2] = a.msgId >> 8; p[o + 3] = a.msgId & 0xff;
            p[o + 4] = a.missing >> 8; p[o + 5] = a.missing & 0xff;
          });
          job.frames = [this._frame(TYPE.ACK, p)];
        }
        if (job.msg) {
          if (this._fullyAcked(job.msg)) continue; // the last acks arrived while it waited
          job.frames = this._msgFrames(job.msg, this._retryParts(job.msg));
          job.msg.status = 'sending';
          job.msg.tries++;
          job.msg.nacks = new Map();
          this.onEvent({ type: 'update', msg: job.msg });
        }
        this.onEvent({ type: 'tx', on: true, kind: job.kind });
        await this.io.transmit(job.frames);
        this.onEvent({ type: 'tx', on: false, kind: job.kind });
        if (job.kind === 'msg') {
          this._reserve(this.id, this.clock.now());
          this._afterSent(job.msg);
        }
      }
    } finally {
      this.txActive = false;
    }
  }

  _fullyAcked(msg) {
    return [...msg.expected.keys()].every((id) => msg.ackedBy.has(id) || !this.peers.has(id));
  }

  _status(msg) {
    if (!msg.expected.size) return 'sent-nobody';
    return msg.ackedBy.size && this._fullyAcked(msg) ? 'delivered' : 'sent';
  }

  /**
   * Parts for the next attempt: if everyone still waiting told us which parts
   * they miss, only those; if anyone said nothing, all of them.
   */
  _retryParts(msg) {
    const all = msg.parts.map((_, i) => i);
    if (!msg.tries) return all;
    const waiting = [...msg.expected.keys()].filter((id) => !msg.ackedBy.has(id) && this.peers.has(id));
    if (!waiting.length || waiting.some((id) => !msg.nacks?.has(id))) return all;
    let mask = 0;
    for (const id of waiting) mask |= msg.nacks.get(id);
    const out = all.filter((i) => mask & (1 << i));
    return out.length ? out : all;
  }

  _afterSent(msg) {
    msg.status = this._status(msg);
    this.onEvent({ type: 'update', msg });
    if (!msg.expected.size) return;
    // wait for acknowledgements: time for everyone's back-off plus an ACK frame each,
    // extended while the channel is in use (the others cannot answer yet)
    const wait = ACK_START + (this.peers.size + 1) * this.slot + 1500;
    let extra = 0;
    const check = () => {
      if (!this.running) return;
      if ((this.channelBusy() || this.queue.length) && extra < 120000) {
        extra += 2000;
        this._after(2000, check);
        return;
      }
      if (this._fullyAcked(msg)) return;
      if (msg.tries <= RETRIES) {
        this._enqueue(this._job('msg', [], { msg }));
      } else {
        msg.status = msg.ackedBy.size ? 'partial' : 'failed';
        this.onEvent({ type: 'update', msg });
      }
    };
    this._after(wait, check);
  }

  // ---------- receiving ----------
  /**
   * Someone transmitted but the frame could not be decoded (or was not ours).
   * It may have been the end of a message, so keep out of the ack slots.
   */
  noteActivity() {
    const now = this.clock.now();
    this.lastHeard = now;
    this.reservedUntil = Math.max(this.reservedUntil, now + ACK_START + this.peers.size * this.slot);
  }

  /** Feed every decoded frame content here. Returns the parsed frame or null. */
  receive(content) {
    const f = parse(content);
    if (!f || f.from === this.id) return null;
    const now = this.clock.now();
    if (f.room !== this.room) { this.lastHeard = now; return null; } // same air, another room
    this.lastHeard = now;
    const known = this.peers.get(f.from);
    if (f.type === TYPE.BYE) {
      if (known) { this.peers.delete(f.from); this._peersChanged(); }
      return f;
    }
    const name = f.type === TYPE.HELLO ? f.name : known?.name || '';
    this.peers.set(f.from, { name, lastSeen: now });
    // Heard someone new without their greeting: ask everyone to introduce themselves.
    if (!known && f.type !== TYPE.HELLO && this.running && now - (this.lastAsk || -Infinity) > 20000) {
      this.lastAsk = now;
      this.sendHello(true);
    }
    if (!known || (f.type === TYPE.HELLO && known.name !== f.name)) this._peersChanged();
    // Someone we did not know yet joins the expected list of messages still waiting for acks.
    if (f.type === TYPE.HELLO) {
      if (f.wantReply && now - this.lastHelloReply > 10000 && this.running) {
        this.lastHelloReply = now;
        this._after(rand(...HELLO_REPLY), () => this.sendHello(false));
      }
    } else if (f.type === TYPE.MSG) {
      this._onMsg(f, now);
    } else if (f.type === TYPE.ACK) {
      for (const a of f.acks) {
        if (a.to !== this.id) continue;
        const msg = this.messages.find((m) => m.mine && m.msgId === a.msgId);
        if (!msg || msg.ackedBy.has(f.from)) continue;
        if (!msg.expected.has(f.from)) msg.expected.set(f.from, this.peers.get(f.from)?.name || '');
        if (a.missing) {
          (msg.nacks ||= new Map()).set(f.from, a.missing); // they need some parts again
          continue;
        }
        msg.ackedBy.set(f.from, this.peers.get(f.from)?.name || '');
        if (msg.status !== 'sending') msg.status = this._status(msg);
        this.onEvent({ type: 'update', msg });
      }
    }
    return f;
  }

  _onMsg(f, now) {
    const key = `${f.from}:${f.msgId}`;
    // Every frame says how many follow, so everyone knows when this burst ends.
    const endAt = now + f.left * this.io.frameTime;
    this._reserve(f.from, endAt);
    if (!this.delivered.has(key)) {
      let p = this.partial.get(key);
      if (!p) {
        p = { parts: new Array(f.parts), got: 0, time: now };
        this.partial.set(key, p);
      }
      if (!p.parts[f.part]) { p.parts[f.part] = f.chunk; p.got++; }
      this.onEvent({ type: 'incoming', key, from: f.from, name: this.peers.get(f.from)?.name || '', got: p.got, parts: f.parts });
      if (p.got === f.parts) this._complete(key, f, p, now);
    }
    // Answer once the burst is over: a full ACK, or the parts still missing.
    // (Also when we already had it: our earlier ACK was evidently not heard.)
    const prev = this.responses.get(key);
    if (prev) this.clock.clearTimeout(prev);
    this.responses.set(key, this._after(Math.max(0, endAt - now) + 20, () => {
      this.responses.delete(key);
      const p = this.partial.get(key);
      let mask = 0;
      if (p) for (let i = 0; i < p.parts.length; i++) if (!p.parts[i]) mask |= 1 << i;
      this._ack(f.from, f.msgId, endAt, mask);
    }));
  }

  _complete(key, f, p, now) {
    this.partial.delete(key);
    this.delivered.add(key);
    const total = p.parts.reduce((a, c) => a + c.length, 0);
    const bytes = new Uint8Array(total);
    let o = 0;
    for (const c of p.parts) { bytes.set(c, o); o += c.length; }
    const msg = {
      key, msgId: f.msgId, from: f.from, name: this.peers.get(f.from)?.name || '', mine: false,
      text: dec.decode(bytes), time: now,
    };
    this.messages.push(msg);
    this.onEvent({ type: 'message', msg });
  }

  /** Acknowledge in my slot (participants sorted by id, the sender excluded); slots start at `end`. */
  _ack(to, msgId, end, missing) {
    const now = this.clock.now();
    this.pendingAcks.set(`${to}:${msgId}`, { to, msgId, missing });
    const order = this._reserve(to, end);
    const at = end + ACK_START + Math.max(0, order.indexOf(this.id)) * this.slot + rand(0, 150);
    const job = this.queue.find((j) => j.kind === 'ack');
    if (job) { job.at = job.late ? at : Math.min(job.at, at); job.late = false; }
    else this._enqueue(this._job('ack', [], { at }));
    this._after(Math.max(0, at - now) + 1, () => this._pump());
  }
}
