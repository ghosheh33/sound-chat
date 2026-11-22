// Several chat nodes on a simulated shared acoustic channel (virtual time).
// Overlapping transmissions collide, a node cannot hear while it talks,
// frames can be lost at random, and silence is only noticed after a delay.
import { ChatNode, parse, TYPE, PEER_TIMEOUT } from '../js/chat.js';
import assert from 'node:assert/strict';

// mulberry32: a simple LCG here showed correlated draws at a fixed stride,
// which the regular event pattern of the simulation turned into repeated losses.
let seed = Number(process.env.SEED || 77);
Math.random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

class World {
  constructor({ loss = 0, frameDur = 1.36, detect = 0.2 }) {
    this.t = 0;
    this.events = [];
    this.seq = 0;
    this.tx = []; // { from, start, end }
    this.nodes = [];
    this.loss = loss;
    this.frameDur = frameDur * 1000;
    this.detect = detect * 1000;
    this.stats = { frames: 0, collided: 0, lost: 0 };
  }

  clock() {
    return {
      now: () => this.t,
      setTimeout: (fn, ms) => { const e = { at: this.t + ms, fn, id: ++this.seq }; this.events.push(e); return e; },
      clearTimeout: (e) => { if (e) e.cancelled = true; },
    };
  }

  io(nodeRef) {
    return {
      frameSize: 64,
      frameTime: this.frameDur,
      busy: () => this.tx.some((x) => x.from !== nodeRef.node && x.start + this.detect <= this.t && this.t < x.end),
      transmit: (frames) => new Promise((resolve) => {
        let start = this.t;
        for (const content of frames) {
          const rec = { from: nodeRef.node, start, end: start + this.frameDur, content };
          this.tx.push(rec);
          this.clock().setTimeout(() => this._deliver(rec), start + this.frameDur - this.t);
          start += this.frameDur;
        }
        this.clock().setTimeout(resolve, start - this.t);
      }),
    };
  }

  _deliver(rec) {
    this.stats.frames++;
    if (process.env.V && this.trace) {
      const f = parse(rec.content);
      const ov = this.tx.some((x) => x !== rec && x.from !== rec.from && x.start < rec.end && rec.start < x.end);
      console.log(`${(rec.start / 1000).toFixed(1).padStart(7)}s ${rec.from.name.padEnd(5)} ${['', 'HELLO', 'MSG', 'ACK', 'BYE'][f.type]}${f.type === 2 ? ` ${f.msgId} ${f.part + 1}/${f.parts}` : ''}${f.type === 3 ? ' ' + f.acks.map((a) => a.msgId + (a.missing ? '/miss:' + a.missing.toString(2) : '')).join(',') : ''}${ov ? '  ✗ collision' : ''}`);
    }
    const overlap = this.tx.some((x) => x !== rec && x.from !== rec.from && x.start < rec.end && rec.start < x.end);
    for (const n of this.nodes) {
      if (n === rec.from || n.off) continue;
      const talking = this.tx.some((x) => x.from === n && x.start < rec.end && rec.start < x.end);
      if (overlap || talking) { this.stats.collided++; continue; }
      if (Math.random() < this.loss) { this.stats.lost++; n.noteActivity(); if (process.env.V && this.trace) console.log(`          lost at ${n.name}`); continue; } // heard, not decoded
      n.receive(rec.content);
    }
  }

  add(name, room = 0) {
    const ref = {};
    const node = new ChatNode({ id: (Math.random() * 65536) | 0, name, room, io: this.io(ref), clock: this.clock(), onEvent: (e) => { if (process.env.V && this.trace && e.type !== 'tx') console.log(`          [${name}] ${e.type} ${e.msg ? e.msg.status + ' ' + (e.msg.text || '').slice(0, 10) : ''} ${e.got ? e.got + '/' + e.parts : ''}`); } });
    ref.node = node;
    this.nodes.push(node);
    return node;
  }

  async run(ms) {
    const until = this.t + ms;
    for (;;) {
      this.events.sort((a, b) => a.at - b.at || a.id - b.id);
      const e = this.events.find((x) => !x.cancelled);
      if (!e || e.at > until) break;
      this.events.splice(this.events.indexOf(e), 1);
      this.t = e.at;
      e.fn();
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      this.tx = this.tx.filter((x) => x.end > this.t - 60000);
    }
    this.t = until;
  }
}

const statusOf = (m) => `${m.status} ${m.ackedBy.size}/${m.expected.size}`;

// ---- 1) Two people ----
{
  const w = new World({ loss: 0.05 });
  const a = w.add('أحمد'), b = w.add('سارة');
  a.start();
  await w.run(3000);
  b.start();
  await w.run(30000);
  assert.equal(a.count(), 2);
  assert.equal(b.count(), 2);
  assert.equal(b.activePeers()[0].name, 'أحمد');
  w.trace = true;
  const m = a.send('مرحبا سارة! كيف حالك؟ هذه رسالة عبر الصوت فقط.');
  await w.run(60000);
  assert.equal(m.status, 'delivered', statusOf(m));
  assert.equal(b.messages.at(-1).text, 'مرحبا سارة! كيف حالك؟ هذه رسالة عبر الصوت فقط.');
  assert.equal(b.messages.at(-1).name, 'أحمد');
  console.log(`two people: count ${a.count()}/${b.count()}, message ${statusOf(m)} at t=${(w.t / 1000).toFixed(0)}s`);
}

// ---- 2) Four people, simultaneous messages, 15% loss ----
{
  const w = new World({ loss: 0.15 });
  const names = ['أحمد', 'سارة', 'Omar', 'ليلى'];
  const nodes = names.map((n) => w.add(n));
  for (const n of nodes) { n.start(); await w.run(2000 + Math.random() * 3000); }
  await w.run(90000); // periodic hellos fill in anyone missed
  for (const n of nodes) assert.equal(n.count(), 4, `${n.name} sees ${n.count()}`);
  const long = 'رسالة طويلة نسبياً '.repeat(12); // several frames
  w.trace = true;
  const t0 = w.t;
  const sent = [nodes[0].send('الكل يسمعني؟'), nodes[2].send('Hello everyone'), nodes[3].send(long)];
  if (process.env.V) console.log('msg ids', sent.map((m) => `${m.name}=${m.msgId}`).join(' '));
  // 15% loss and four people sharing one channel: give it up to 7 minutes
  for (let i = 0; i < 21 && sent.some((m) => m.status !== 'delivered'); i++) await w.run(20000);
  const took = (w.t - t0) / 1000;
  for (const m of sent) assert.equal(m.status, 'delivered', `${m.name}: ${statusOf(m)}`);
  for (const n of nodes) {
    const got = n.messages.filter((m) => !m.mine).length;
    const mineCount = n.messages.filter((m) => m.mine).length;
    assert.equal(got, 3 - mineCount, `${n.name} got ${got}`);
  }
  // long texts are cut at MAX_TEXT bytes on a character boundary; receivers get exactly what was sent
  assert.ok(new TextEncoder().encode(sent[2].text).length <= 400 && long.startsWith(sent[2].text));
  assert.equal(nodes[1].messages.find((m) => m.name === 'ليلى').text, sent[2].text);
  console.log(`four people: all see 4, 3 messages delivered to everyone in ${took.toFixed(0)}s; frames ${w.stats.frames}, collisions ${w.stats.collided}, lost ${w.stats.lost}`);

  // 3) Someone leaves (BYE) and someone disappears silently
  const leaving = nodes[3].stop(); // says BYE (needs the clock running to get on air)
  nodes[2].running = false; nodes[2].off = true; // walks away without BYE
  await w.run(20000);
  await leaving;
  nodes[3].off = true;
  // BYE is sent twice but is best effort: most listeners drop the leaver at once
  assert.ok(nodes.slice(0, 2).some((n) => n.count() === 3), 'BYE removes at once');
  await w.run(PEER_TIMEOUT + 20000);
  assert.equal(nodes[0].count(), 2, 'silent peer times out');
  assert.equal(nodes[1].count(), 2);
  console.log('leaving: BYE removed at once, silent peer timed out, count back to 2');
}

// ---- 4) Rooms do not mix; frames are validated ----
{
  const w = new World({});
  const a = w.add('A', 1), b = w.add('B', 2), c = w.add('C', 1);
  [a, b, c].forEach((n) => n.start());
  await w.run(60000);
  assert.equal(a.count(), 2);
  assert.equal(b.count(), 1);
  assert.equal(parse(new Uint8Array(64)), null, 'file-transfer or noise frames are ignored');
  const f = new Uint8Array(64); f[0] = 0xc0 | TYPE.MSG; f[4] = 200;
  assert.equal(parse(f), null);
  console.log('rooms: separate rooms do not see each other; invalid frames ignored');
}
console.log('chat: ok');
