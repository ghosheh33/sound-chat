import { ChatNode, MAX_TEXT, makeFrame, TYPE } from './chat.js';
import { ChatAudio, PROFILES, frameTime } from './audio.js';
import { t, people, ago, applyLang, setLang, getLang } from './i18n.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const enc = new TextEncoder();

// ---------- state ----------
let myId = store.get('sc-id', 0);
if (!myId) { myId = 1 + Math.floor(Math.random() * 65534); store.set('sc-id', myId); }
const S = {
  name: store.get('sc-name', ''),
  room: store.get('sc-room', 1),
  profile: store.get('sc-profile', 'silent'),
  node: null,
  items: [], // what the log shows: { kind: 'msg' | 'sys', ... }
  els: new Map(), // msg key -> element
  level: 0,
  tx: false,
  known: new Map(), // peers seen this session (for joined/left notes)
};
if (!PROFILES[S.profile]) S.profile = 'silent';

// ---------- audio ----------
let testFrame = null;
let testHeard = false;
const audio = new ChatAudio({
  onFrame: (content) => {
    if (testFrame && content.every((v, i) => v === testFrame[i])) { testHeard = true; return; }
    S.node?.receive(content);
  },
  onActivity: () => S.node?.noteActivity(),
  onLevel: (v) => { S.level = Math.max(S.level * 0.8, v); },
});
audio.setVolume(store.get('sc-vol', 0.8));

const io = {
  get frameSize() { return PROFILES[S.profile].mode.content; },
  get frameTime() { return frameTime(S.profile); },
  busy: () => audio.busy(),
  transmit: (frames) => audio.transmit(frames, S.profile),
};
const clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h),
};

// ---------- wake lock ----------
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* not allowed */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.node) keepAwake(true);
});

// ---------- join screen ----------
function renderProfiles(box) {
  box.innerHTML = '';
  for (const key of Object.keys(PROFILES)) {
    const b = el('button', 'profile' + (S.profile === key ? ' on' : ''));
    b.type = 'button';
    b.append(el('b', null, t(`p_${key}`)), el('span', null, t(`h_${key}`)));
    b.addEventListener('click', () => {
      S.profile = key;
      store.set('sc-profile', key);
      renderProfiles($('#profiles'));
      renderProfiles($('#profiles2'));
      updateCounter();
    });
    box.append(b);
  }
}

function renderStatic() {
  applyLang();
  $('#langBtn').textContent = getLang() === 'ar' ? 'English' : 'العربية';
  renderProfiles($('#profiles'));
  renderProfiles($('#profiles2'));
  if (S.node) renderHeader();
  updateCounter();
}

$('#name').value = S.name;
$('#room').value = S.room;
$('#langBtn').addEventListener('click', () => {
  setLang(getLang() === 'ar' ? 'en' : 'ar');
  renderStatic();
  renderLog();
});

function joinStatus(msg, cls = '') {
  $('#joinStatus').textContent = msg;
  $('#joinStatus').className = `status ${cls}`;
}

async function startAudio() {
  try {
    await audio.start();
    return true;
  } catch {
    joinStatus(window.isSecureContext ? t('micDenied') : t('micInsecure'), 'bad');
    return false;
  }
}

$('#testBtn').addEventListener('click', async () => {
  if (!(await startAudio())) return;
  joinStatus(t('testing'));
  const prof = S.profile === 'audible' ? 'audible' : S.profile;
  const { mode } = PROFILES[prof];
  testFrame = makeFrame(mode.content, TYPE.HELLO, myId, 255, new Uint8Array([0, 4, 116, 101, 115, 116]));
  testHeard = false;
  await audio.transmit([testFrame], prof, { keepMic: true });
  await new Promise((r) => setTimeout(r, 900));
  testFrame = null;
  if (!S.node) audio.stop();
  joinStatus(testHeard ? t('testOk') : t('testFail'), testHeard ? 'ok' : 'bad');
});

$('#joinBtn').addEventListener('click', async () => {
  S.name = $('#name').value.trim() || t('someone');
  S.room = Math.max(0, Math.min(254, Number($('#room').value) || 0));
  store.set('sc-name', S.name);
  store.set('sc-room', S.room);
  $('#joinBtn').disabled = true;
  const ok = await startAudio();
  $('#joinBtn').disabled = false;
  if (!ok) return;
  enterRoom();
});

// ---------- chat ----------
function historyKey() {
  return `sc-log-${S.room}`;
}

function enterRoom() {
  S.items = store.get(historyKey(), []).slice(-200).map((m) => ({ ...m, old: true }));
  S.els.clear();
  S.known.clear();
  S.node = new ChatNode({ id: myId, name: S.name, room: S.room, io, clock, onEvent });
  S.node.start();
  $('#join').hidden = true;
  $('#chat').hidden = false;
  renderHeader();
  renderLog();
  updateCounter();
  keepAwake(true);
  requestAnimationFrame(tick);
}

async function leaveRoom() {
  const node = S.node;
  S.node = null;
  $('#chat').hidden = true;
  $('#join').hidden = false;
  joinStatus('');
  keepAwake(false);
  if (node) await node.stop(); // says goodbye
  if (!S.node) audio.stop();
}

$('#leaveBtn').addEventListener('click', () => {
  if (confirm(t('leaveConfirm'))) leaveRoom();
});

function onEvent(e) {
  if (!S.node) return;
  if (e.type === 'peers') {
    const now = new Set(e.peers.map((p) => p.id));
    for (const p of e.peers) {
      if (!S.known.has(p.id) && p.name) addSys(t('joined', { name: p.name }));
      if (p.name) S.known.set(p.id, p.name);
    }
    for (const [id, name] of S.known) {
      if (!now.has(id)) { addSys(t('left', { name })); S.known.delete(id); }
    }
    renderHeader();
  } else if (e.type === 'message') {
    const m = e.msg;
    addMsg({ kind: 'msg', key: m.key, mine: m.mine, name: m.name, text: m.text, time: Date.now(), status: m.status });
    if (!m.mine) {
      $('#incoming').hidden = true;
      if (navigator.vibrate) navigator.vibrate(60);
    }
  } else if (e.type === 'update') {
    updateMsg(e.msg);
  } else if (e.type === 'incoming') {
    if (e.got < e.parts) {
      $('#incoming').hidden = false;
      $('#incoming').textContent = t('receivingFrom', { name: e.name || t('someone'), got: e.got, parts: e.parts });
      clearTimeout(onEvent.inc);
      onEvent.inc = setTimeout(() => { $('#incoming').hidden = true; }, 20000);
    }
  } else if (e.type === 'tx') {
    S.tx = e.on;
  }
}

function renderHeader() {
  $('#roomTitle').textContent = t('roomTitle', { n: S.room });
  $('#peopleTxt').textContent = people(S.node ? S.node.count() : 1);
}

function persist() {
  const keep = S.items.filter((i) => i.kind === 'msg').slice(-200)
    .map(({ key, mine, name, text, time, status, ackedNames }) => ({ kind: 'msg', key, mine, name, text, time, status, ackedNames }));
  store.set(historyKey(), keep);
}

function addSys(text) {
  S.items.push({ kind: 'sys', text, time: Date.now() });
  renderLog();
}

function addMsg(item) {
  S.items.push(item);
  persist();
  renderLog();
}

function statusText(it) {
  switch (it.status) {
    case 'queued': return ['🕓', t('queued')];
    case 'sending': return ['🕓', t('sending')];
    case 'sent': return it.acked ? ['✓', t('deliveredTo', { n: it.acked, m: it.expected })] : ['✓', t('sent')];
    case 'sent-nobody': return ['✓', t('sentNobody')];
    case 'delivered': return ['✓✓', t('delivered')];
    case 'partial': return ['⚠', t('deliveredTo', { n: it.acked, m: it.expected })];
    case 'failed': return ['⚠', t('failed')];
    default: return ['', ''];
  }
}

function updateMsg(m) {
  const it = S.items.find((i) => i.key === m.key);
  if (!it) return;
  it.status = m.status;
  it.acked = m.ackedBy?.size || 0;
  it.expected = m.expected?.size || 0;
  it.ackedNames = [...(m.ackedBy?.values() || [])].filter(Boolean);
  persist();
  const node = S.els.get(m.key);
  if (node) node.replaceWith(renderItem(it));
}

function renderItem(it) {
  if (it.kind === 'sys') return el('div', 'sys', it.text);
  const b = el('div', `msg${it.mine ? ' mine' : ''}${it.status === 'failed' || it.status === 'partial' ? ' failed' : ''}`);
  if (!it.mine) b.append(el('div', 'who', it.name || t('someone')));
  const text = el('div', 'text', it.text);
  text.dir = 'auto';
  b.append(text);
  const meta = el('div', 'meta');
  meta.append(el('span', null, new Date(it.time).toLocaleTimeString(getLang() === 'ar' ? 'ar' : 'en', { hour: '2-digit', minute: '2-digit' })));
  if (it.mine) {
    const [icon, label] = statusText(it);
    const st = el('span', 'ticks', icon);
    st.title = label + (it.ackedNames?.length ? ` — ${it.ackedNames.join('، ')}` : '');
    meta.append(st);
    if (!it.old && (it.status === 'failed' || it.status === 'partial') && S.node) {
      const r = el('button', null, t('retry'));
      r.addEventListener('click', () => {
        S.items = S.items.filter((x) => x !== it);
        S.node.send(it.text); // appears again at the bottom with a fresh status
        persist();
        renderLog();
      });
      meta.append(r);
    } else if (it.status !== 'delivered') {
      meta.append(el('span', null, label));
    }
  }
  b.append(meta);
  if (it.key) S.els.set(it.key, b);
  return b;
}

function renderLog() {
  const log = $('#log');
  log.innerHTML = '';
  S.els.clear();
  if (!S.items.length) log.append(el('p', 'empty', t('empty')));
  for (const it of S.items) log.append(renderItem(it));
  log.scrollTop = log.scrollHeight;
}

// ---------- composer ----------
const msgBox = $('#msg');
function updateCounter() {
  const n = enc.encode(msgBox.value).length;
  const per = PROFILES[S.profile].mode.content - 10;
  const parts = Math.max(1, Math.ceil(Math.min(n, MAX_TEXT) / per));
  const secs = Math.round((parts * frameTime(S.profile)) / 1000 + 1);
  const c = $('#counter');
  c.textContent = n ? t('bytes', { n, max: MAX_TEXT, t: t('s', { n: secs }) }) : '';
  c.classList.toggle('over', n > MAX_TEXT);
  $('#sendBtn').disabled = n === 0;
}
msgBox.addEventListener('input', () => {
  msgBox.style.height = 'auto';
  msgBox.style.height = `${Math.min(140, msgBox.scrollHeight)}px`;
  updateCounter();
});
msgBox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('#composer').requestSubmit();
  }
});
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = msgBox.value.trim();
  if (!text || !S.node) return;
  S.node.send(text);
  msgBox.value = '';
  msgBox.style.height = 'auto';
  updateCounter();
  msgBox.focus();
});

// ---------- header widgets ----------
function tick() {
  if (!S.node) return;
  const db = 20 * Math.log10(S.level + 1e-6);
  $('#meter').style.width = `${Math.max(0, Math.min(100, ((db + 70) / 60) * 100))}%`;
  S.level *= 0.92;
  const busy = !S.tx && audio.busy();
  $('#dot').className = `dot${S.tx ? ' tx' : busy ? ' busy' : ''}`;
  $('#stateTxt').textContent = S.tx ? t('sendingNow') : busy ? t('channelBusy') : `${t('listening')} · ${t(`p_${S.profile}`)}`;
  requestAnimationFrame(tick);
}

$('#peopleBtn').addEventListener('click', () => {
  const list = $('#peopleList');
  list.innerHTML = '';
  const meLi = el('li');
  meLi.append(el('b', null, `${S.name} (${t('you')})`));
  list.append(meLi);
  for (const p of S.node?.activePeers() || []) {
    const li = el('li');
    li.append(el('span', null, p.name || t('someone')), el('span', 'muted', t('lastSeen', { t: ago(performance.now() - p.lastSeen) })));
    list.append(li);
  }
  $('#peopleTitle').textContent = people(S.node ? S.node.count() : 1);
  $('#peopleSheet').showModal();
});
$('#settingsBtn').addEventListener('click', () => $('#settingsSheet').showModal());
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$('#vol').value = store.get('sc-vol', 0.8);
$('#volOut').textContent = `${Math.round($('#vol').value * 100)}%`;
$('#vol').addEventListener('input', () => {
  const v = Number($('#vol').value);
  $('#volOut').textContent = `${Math.round(v * 100)}%`;
  audio.setVolume(v);
  store.set('sc-vol', v);
});

// ---------- start ----------
renderStatic();
window.addEventListener('pagehide', () => { S.node?.stop(); });
if ('serviceWorker' in navigator && window.isSecureContext && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
