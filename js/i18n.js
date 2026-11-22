// Arabic / English strings for the chat.

const STR = {
  ar: {
    app: 'دردشة بالصوت',
    tagline: 'محادثة بين هواتف قريبة عبر صوت لا تسمعه الأذن — بدون إنترنت أو شبكة أو بلوتوث.',
    yourName: 'اسمك', namePh: 'مثلاً: أحمد',
    room: 'رقم الغرفة', roomHint: 'من يختار الرقم نفسه يكون في المحادثة نفسها.',
    sound: 'نوع الصوت',
    p_silent: 'صامت (فوق السمع)', h_silent: '18–20 كيلوهرتز، لا يسمعه معظم الناس',
    'p_silent-far': 'صامت — مدى أبعد', 'h_silent-far': 'أبطأ لكن أقوى على المسافة',
    p_audible: 'مسموع', h_audible: 'لهواتف لا تصدر/تلتقط الترددات العالية',
    join: 'دخول المحادثة',
    testDevice: 'اختبر جهازك', testing: 'يختبر… (ثانيتان)',
    testOk: 'جهازك يرسل ويستقبل بالصوت الصامت ✓', testFail: 'لم يلتقط الجهاز إشارته الصامتة. جرّب رفع الصوت، أو استخدم «مسموع».',
    micDenied: 'يحتاج التطبيق الميكروفون. اسمح به من إعدادات المتصفح.', micInsecure: 'الميكروفون يحتاج فتح التطبيق عبر https.',
    people: { one: 'شخص واحد (أنت)', many: '{n} أشخاص في المحادثة', two: 'شخصان في المحادثة' },
    you: 'أنت', lastSeen: 'آخر ظهور قبل {t}',
    roomTitle: 'غرفة {n}',
    listening: 'يستمع', sendingNow: 'يرسل…', channelBusy: 'أحد يتحدث…',
    msgPh: 'اكتب رسالة…', send: 'إرسال',
    bytes: '{n}/{max} بايت · نحو {t}',
    queued: 'بالانتظار', sending: 'يُرسل…', sent: 'بانتظار تأكيد الاستلام…',
    nobody: 'لا أحد في الغرفة بعد — تُرسل تلقائياً عند انضمام أحد',
    delivered: 'وصلت للجميع', deliveredTo: 'وصلت إلى {n} من {m}',
    failed: 'لم يؤكد أحد الاستلام — تُعاد تلقائياً عند عودتهم', partialHint: 'الباقون تُعاد لهم عند عودتهم',
    retry: 'أعد الإرسال',
    backgroundWarn: 'أبقِ الشاشة مفتوحة والتطبيق ظاهراً: عند قفل الشاشة يتوقف الاستماع.',
    receivingFrom: '{name} يرسل رسالة… ({got}/{parts})',
    joined: 'انضم {name}', left: 'غادر {name}', someone: 'شخص',
    leave: 'مغادرة', leaveConfirm: 'مغادرة المحادثة؟',
    settings: 'الإعدادات', volume: 'مستوى الصوت', close: 'إغلاق',
    volumeHint: 'إذا سمعت صوتاً أو أزيزاً من هذا الهاتف أثناء الإرسال، خفّض المستوى إلى 50–60٪.',
    muteTx: 'أوقف الميكروفون أثناء الإرسال',
    muteTxHint: 'جرّبه إذا لم تسمع الهواتف الأخرى هذا الهاتف: بعض الهواتف تُضعف السمّاعة أو تشوّهها والميكروفون يعمل.',
    hearsYou: 'يسمعك ✓', notHearYou: 'لا يسمعك ✗', unknownHear: 'لم يُعرف بعد إن كان يسمعك',
    indirect: 'لا تسمعه مباشرة — يسمعه {via}', someoneUnknown: 'شخص آخر',
    notHeardBy: '⚠ {names} لا {verb} هذا الهاتف. رسائلك لن تصله.', verbOne: 'يسمع', verbMany: 'يسمعون',
    nobodyHears: '⚠ لا أحد يسمع هذا الهاتف — الهواتف الأخرى لا تلتقط صوته الصامت.',
    reachFix: 'جرّب: تقريب الهواتف، أو خفض/رفع مستوى الصوت، أو «إيقاف الميكروفون أثناء الإرسال»، أو «مسموع».',
    useAudible: 'استخدم «مسموع»',
    empty: 'لا رسائل بعد. اكتب أول رسالة — تصل لكل من في الغرفة.',
    s: '{n} ث', m: '{n} د', h: '{n} س',
    note: 'ملاحظة: الأطفال وبعض الشباب والحيوانات الأليفة قد يسمعون الترددات العالية. أبقِ الهواتف قريبة (حتى 1–2 متر) وثابتة نسبياً.',
  },
  en: {
    app: 'Sound Chat',
    tagline: 'Chat between nearby phones using sound you cannot hear — no internet, network or Bluetooth.',
    yourName: 'Your name', namePh: 'e.g. Sam',
    room: 'Room number', roomHint: 'Everyone who picks the same number is in the same chat.',
    sound: 'Sound',
    p_silent: 'Silent (ultrasonic)', h_silent: '18–20 kHz, inaudible to most people',
    'p_silent-far': 'Silent — longer range', 'h_silent-far': 'slower but sturdier over distance',
    p_audible: 'Audible', h_audible: 'for phones that cannot play/record high notes',
    join: 'Join the chat',
    testDevice: 'Test your phone', testing: 'Testing… (2 seconds)',
    testOk: 'Your phone sends and receives silent sound ✓', testFail: 'Your phone did not pick up its own silent signal. Raise the volume or use “Audible”.',
    micDenied: 'The app needs the microphone. Allow it in the browser settings.', micInsecure: 'The microphone needs the app to be opened over https.',
    people: { one: 'Just you', many: '{n} people in the chat', two: '2 people in the chat' },
    you: 'You', lastSeen: 'last heard {t} ago',
    roomTitle: 'Room {n}',
    listening: 'Listening', sendingNow: 'Sending…', channelBusy: 'Someone is talking…',
    msgPh: 'Type a message…', send: 'Send',
    bytes: '{n}/{max} bytes · about {t}',
    queued: 'Waiting', sending: 'Sending…', sent: 'Waiting for confirmation…',
    nobody: 'Nobody in the room yet — sent automatically when someone joins',
    delivered: 'Delivered to everyone', deliveredTo: 'Delivered to {n} of {m}',
    failed: 'Nobody confirmed it — resent automatically when they are back', partialHint: 'resent to the others when they are back',
    retry: 'Send again',
    backgroundWarn: 'Keep the screen on and the app in front: a locked screen stops listening.',
    receivingFrom: '{name} is sending a message… ({got}/{parts})',
    joined: '{name} joined', left: '{name} left', someone: 'Someone',
    leave: 'Leave', leaveConfirm: 'Leave the chat?',
    settings: 'Settings', volume: 'Volume', close: 'Close',
    volumeHint: 'If you can hear a sound or buzz from this phone while it sends, lower the volume to 50–60%.',
    muteTx: 'Turn the microphone off while sending',
    muteTxHint: 'Try it if the other phones do not hear this one: some phones weaken or distort the speaker while the microphone is on.',
    hearsYou: 'hears you ✓', notHearYou: 'does not hear you ✗', unknownHear: 'not known yet whether they hear you',
    indirect: 'you do not hear them directly — {via} does', someoneUnknown: 'Someone else',
    notHeardBy: '⚠ {names} {verb} not hear this phone. Your messages will not reach them.', verbOne: 'does', verbMany: 'do',
    nobodyHears: '⚠ Nobody hears this phone — the other phones do not pick up its silent sound.',
    reachFix: 'Try: phones closer, volume lower/higher, “Turn the microphone off while sending”, or “Audible”.',
    useAudible: 'Use “Audible”',
    empty: 'No messages yet. Write the first one — everyone in the room gets it.',
    s: '{n} s', m: '{n} min', h: '{n} h',
    note: 'Note: children, some young people and pets may hear high frequencies. Keep phones close (up to 1–2 m) and fairly still.',
  },
};

let lang = 'ar';
try {
  const saved = localStorage.getItem('sc-lang');
  if (saved === 'ar' || saved === 'en') lang = saved;
  else if (!(navigator.language || '').startsWith('ar')) lang = 'en';
} catch { /* storage blocked */ }

export const getLang = () => lang;

export function t(key, vars = {}) {
  let s = STR[lang][key] ?? STR.ar[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function people(n) {
  const p = STR[lang].people;
  if (n <= 1) return p.one;
  if (n === 2) return p.two;
  return p.many.replace('{n}', n);
}

export function ago(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return t('s', { n: s });
  if (s < 3600) return t('m', { n: Math.round(s / 60) });
  return t('h', { n: Math.round(s / 3600) });
}

export function applyLang(root = document) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.title = t('app');
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
}

export function setLang(l) {
  lang = l;
  try { localStorage.setItem('sc-lang', l); } catch { /* storage blocked */ }
  applyLang();
}
