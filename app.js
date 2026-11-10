(function () {
'use strict';

// ---------- Supabase (online account) ----------
var CFG = window.QAZA_CONFIG || {};
var sb = null;
var user = null;
try {
  if (window.supabase && /^https:\/\//.test(CFG.supabaseUrl || '') && (CFG.supabaseAnonKey || '').length > 20) {
    sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
  }
} catch (e) { sb = null; }

// ---------- constants ----------
var KEY = 'qaza_state_v1';
var PK = ['fajr', 'zuhr', 'asr', 'maghrib', 'isha', 'witr'];
var PN = { fajr: 'Fajr', zuhr: 'Zuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha', witr: 'Witr' };
var CITIES = {
  'Karachi': [24.8607, 67.0011], 'Lahore': [31.5204, 74.3587], 'Islamabad': [33.6844, 73.0479],
  'Rawalpindi': [33.5651, 73.0169], 'Peshawar': [34.0151, 71.5249], 'Quetta': [30.1798, 66.9750],
  'Multan': [30.1575, 71.5249], 'Faisalabad': [31.4504, 73.1350], 'Hyderabad': [25.3960, 68.3578],
  'Sialkot': [32.4945, 74.5229], 'Gujranwala': [32.1877, 74.1945]
};

// ---------- helpers ----------
function n(v) { var x = Number(v); return isFinite(x) ? Math.trunc(x) : 0; }
function num(v) { var x = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(x) ? x : 0; }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function pad(x) { return String(x).padStart(2, '0'); }
function dayKey(t) { return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()); }
function fmtTime(t) { return t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }

// ---------- state ----------
var d = {};
try { d = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { d = {}; }

var ui = { view: 'home', tab: 0, authMode: 'login', busy: false, msg: '' };
var authForm = { email: '', pass: '', gender: '' };
var form = defaultForm();
var installEvt = null;

function female() { return d.gender === 'female'; }
function remindOn() { return d.remind !== false; }
function target() { var t = n(d.target); return t < 1 ? 5 : t; }
function pr(k) { return n((d.prayers || {})[k]); }
function totalLeft() { return PK.reduce(function (a, k) { return a + pr(k); }, 0); }
function totalInitial() { return PK.reduce(function (a, k) { return a + n((d.initial || {})[k]); }, 0); }
function todayDone() { return n((d.log || {})[dayKey(new Date())]); }
function progress() {
  var ini = totalInitial();
  if (ini <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - totalLeft() / ini));
}
function avgPerDay() {
  var l = d.log || {}, now = new Date(), sum = 0, span = 0;
  for (var i = 13; i >= 0; i--) {
    var t = new Date(now.getTime() - i * 86400000);
    var v = n(l[dayKey(t)]);
    if (span === 0 && v === 0) continue;
    span++; sum += v;
  }
  return span === 0 ? 0 : sum / span;
}

var saveTimer = null;
function save(push) {
  d.updatedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
  render();
  if (push !== false) pushSoon();
}
function pushSoon() {
  if (!sb || !user) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(pushCloud, 800);
}
async function pushCloud() {
  if (!sb || !user) return 'Account mein login nahi hain.';
  try {
    var r = await sb.from('qaza_data').upsert({ user_id: user.id, data: d, updated_at: new Date().toISOString() });
    if (r.error) throw r.error;
    return null;
  } catch (e) { return 'Online save nahi hua. Internet check karein.'; }
}
async function afterLogin() {
  if (!sb) return;
  try {
    var s = await sb.auth.getSession();
    user = s.data && s.data.session ? s.data.session.user : null;
  } catch (e) { user = null; }
  if (!user) return;
  try {
    var r = await sb.from('qaza_data').select('data').eq('user_id', user.id).maybeSingle();
    if (r.error) throw r.error;
    if (r.data && r.data.data && typeof r.data.data === 'object') {
      var remote = r.data.data;
      if (n(remote.updatedAt) >= n(d.updatedAt) || !d.setupDone) {
        d = remote;
        try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
      } else { await pushCloud(); }
    } else if (d.gender || d.setupDone) {
      await pushCloud();
    }
  } catch (e) {}
  scheduleTimers();
  render();
}

// ---------- hisab ----------
function defaultForm() {
  return {
    byAge: true, bulugh: '15', age: '', prayed: '0', years: '',
    haiz: '6', children: '0', nifas: '30', roza: true,
    computed: false, res: { fajr: '0', zuhr: '0', asr: '0', maghrib: '0', isha: '0', witr: '0' }, rozaRes: '0'
  };
}
function computeForm() {
  var f = form;
  var years = f.byAge ? (num(f.age) - num(f.bulugh) - num(f.prayed)) : num(f.years);
  if (years < 0) years = 0;
  var days = Math.round(years * 365);
  var roza = f.roza ? Math.round(years * 30) : 0;
  if (female()) {
    days -= Math.round(years * 12 * num(f.haiz)) + n(f.children) * n(f.nifas);
    if (f.roza) roza -= Math.round(years * num(f.haiz));
  }
  if (days < 0) days = 0;
  if (roza < 0) roza = 0;
  PK.forEach(function (k) { f.res[k] = String(days); });
  f.rozaRes = String(roza);
  f.computed = true;
}
function openSetup() {
  form = defaultForm();
  if (d.setupDone) {
    PK.forEach(function (k) { form.res[k] = String(pr(k)); });
    form.rozaRes = String(n(d.roza));
    form.computed = true;
  }
  ui.view = 'setup';
  render();
}
function saveSetup() {
  d.prayers = {}; d.initial = {};
  PK.forEach(function (k) {
    var v = Math.max(0, n(form.res[k]));
    d.prayers[k] = v; d.initial[k] = v;
  });
  d.roza = Math.max(0, n(form.rozaRes));
  d.rozaInitial = d.roza;
  d.setupDone = true;
  ui.view = 'home'; ui.tab = 0;
  save();
  if (d.lat == null) useGps(); else scheduleTimers();
}

// ---------- changes ----------
function bump(name, by) {
  d[name] = d[name] || {};
  var k = dayKey(new Date());
  d[name][k] = Math.max(0, n(d[name][k]) + by);
}
function changePrayer(k, delta) {
  d.prayers = d.prayers || {}; d.initial = d.initial || {};
  var cur = n(d.prayers[k]);
  if (delta < 0 && cur <= 0) return;
  d.prayers[k] = cur + delta;
  if (d.prayers[k] > n(d.initial[k])) d.initial[k] = d.prayers[k];
  bump('log', delta < 0 ? 1 : -1);
  save();
}
function changeRoza(delta) {
  var cur = n(d.roza);
  if (delta < 0 && cur <= 0) return;
  d.roza = cur + delta;
  if (d.roza > n(d.rozaInitial)) d.rozaInitial = d.roza;
  bump('rozaLog', delta < 0 ? 1 : -1);
  save();
}

// ---------- namaz ke auqat (offline, Karachi method + Hanafi Asr) ----------
function timesFor(date) {
  if (!window.adhan || d.lat == null || d.lng == null) return [];
  try {
    var c = new adhan.Coordinates(Number(d.lat), Number(d.lng));
    var p = adhan.CalculationMethod.Karachi();
    p.madhab = adhan.Madhab.Hanafi;
    var t = new adhan.PrayerTimes(c, date, p);
    return [
      { name: 'Fajr', time: t.fajr, pr: true },
      { name: 'Tulu-e-Aftab', time: t.sunrise, pr: false },
      { name: 'Zuhr', time: t.dhuhr, pr: true },
      { name: 'Asr', time: t.asr, pr: true },
      { name: 'Maghrib', time: t.maghrib, pr: true },
      { name: 'Isha', time: t.isha, pr: true }
    ];
  } catch (e) { return []; }
}
function nextPrayer() {
  var now = new Date();
  var today = timesFor(now).filter(function (x) { return x.pr && x.time > now; });
  if (today.length) return today[0];
  var tom = timesFor(new Date(now.getTime() + 86400000)).filter(function (x) { return x.pr; });
  return tom.length ? tom[0] : null;
}
function nextText() {
  var p = nextPrayer();
  if (!p) return '';
  var mins = Math.max(0, Math.round((p.time - new Date()) / 60000));
  var h = Math.floor(mins / 60), m = mins % 60;
  return 'Agli namaz: ' + p.name + ' (' + fmtTime(p.time) + '), ' + (h ? h + ' ghante ' : '') + m + ' minute baad';
}

// ---------- reminder ----------
var timers = [];
function clearTimers() { timers.forEach(clearTimeout); timers = []; }
function scheduleTimers() {
  clearTimers();
  if (!remindOn() || d.lat == null) return;
  var now = Date.now();
  [0, 1].forEach(function (off) {
    timesFor(new Date(now + off * 86400000)).forEach(function (x) {
      if (!x.pr) return;
      var wait = x.time.getTime() - now;
      if (wait > 0 && wait < 2147000000) {
        timers.push(setTimeout(function () {
          fireReminder(x.name + ' ka waqt ho gaya', x.name + ' ke saath ek qaza namaz bhi parh lein.');
        }, wait));
      }
    });
  });
}
function fireReminder(title, body) {
  toast(title + ' - ' + body);
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
  systemNotify(title, body);
}
function systemNotify(title, body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var opts = { body: body, icon: 'icon-192.png', tag: 'qaza-' + Date.now() };
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(function (r) {
        if (r && r.showNotification) r.showNotification(title, opts);
        else new Notification(title, opts);
      }).catch(function () { try { new Notification(title, opts); } catch (e) {} });
    } else { new Notification(title, opts); }
  } catch (e) {}
}
async function askNotifPermission() {
  try {
    if (!('Notification' in window)) { toast('Is browser mein notification nahi hoti.'); return false; }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') { toast('Notification block hai. Browser ki site settings mein allow karein.'); return false; }
    var r = await Notification.requestPermission();
    return r === 'granted';
  } catch (e) { return false; }
}

var toastTimer = null;
function toast(msg) {
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.style.display = 'none'; }, 6000);
}

// ---------- location ----------
function useGps() {
  return new Promise(function (resolve) {
    if (!navigator.geolocation) { toast('Is browser mein location nahi hai. Shehar chun lein.'); return resolve(false); }
    navigator.geolocation.getCurrentPosition(function (p) {
      d.lat = p.coords.latitude; d.lng = p.coords.longitude; d.city = 'GPS location';
      save(); scheduleTimers(); resolve(true);
    }, function () {
      toast('Location nahi mili. Auqat tab mein shehar chun lein.');
      resolve(false);
    }, { enableHighAccuracy: false, timeout: 25000, maximumAge: 3600000 });
  });
}

// ---------- auth ----------
function errMsg(ex) {
  var m = (ex && ex.message) || '';
  if (/Invalid login/i.test(m)) return 'Email ya password galat hai.';
  if (/already registered|already been registered/i.test(m)) return 'Ye email pehle se registered hai. Login karein.';
  if (/Email not confirmed/i.test(m)) return 'Pehle email ka confirm link khol kar confirm karein.';
  if (/rate limit/i.test(m)) return 'Bohat koshishein ho gayin. Thori der baad try karein.';
  return m || 'Masla aaya. Internet check karke dobara koshish karein.';
}
async function doAuth() {
  var email = authForm.email.trim(), pass = authForm.pass || '';
  var signup = ui.authMode === 'signup';
  if (!email || pass.length < 6) { ui.msg = 'Email likhein aur password kam az kam 6 harf ka rakhein.'; return render(); }
  if (signup && !authForm.gender) { ui.msg = 'Mard ya Aurat chunein.'; return render(); }
  ui.busy = true; ui.msg = ''; render();
  try {
    if (signup) {
      var r = await sb.auth.signUp({ email: email, password: pass, options: { data: { gender: authForm.gender } } });
      if (r.error) throw r.error;
      if (!r.data.session) {
        ui.busy = false; ui.authMode = 'login';
        ui.msg = 'Account ban gaya. Email mein confirm link aaya hoga, confirm karke Login karein.';
        return render();
      }
      d.gender = authForm.gender;
      save(false);
      await afterLogin();
    } else {
      var r2 = await sb.auth.signInWithPassword({ email: email, password: pass });
      if (r2.error) throw r2.error;
      await afterLogin();
    }
    ui.busy = false; ui.view = 'home'; ui.msg = '';
    authForm.pass = '';
    render();
  } catch (ex) {
    ui.busy = false; ui.msg = errMsg(ex); render();
  }
}
async function doLogout() {
  if (!confirm('Logout karein? Is browser se data hat jayega. Online save rahega, dobara login karne par wapas aa jayega.')) return;
  await pushCloud();
  try { await sb.auth.signOut(); } catch (e) {}
  user = null; d = {};
  try { localStorage.removeItem(KEY); } catch (e) {}
  clearTimers();
  ui.view = 'home'; ui.tab = 0;
  render();
}

// ---------- views ----------
function welcomeView() {
  return '<div class="wrap"><div class="hero">&#9790;</div>' +
    '<h1 class="center" style="margin:8px 0">Qaza Tracker</h1>' +
    '<p class="center muted" style="font-size:15px">Qaza namaz aur qaza roze ka hisab, aur har namaz par yaad dehani.</p>' +
    (sb ?
      '<button class="btn block" data-act="auth-signup">Naya account banayein</button>' +
      '<button class="btn line block" data-act="auth-login">Login</button>' : '') +
    '<button class="btn link block" data-act="start-local">Bina account ke chalayein (sirf is browser mein)</button></div>';
}
function genderView() {
  return '<div class="wrap"><h2 style="margin-top:40px">Aap kaun hain?</h2>' +
    '<button class="btn block" data-act="gender" data-v="male">Mard</button>' +
    '<button class="btn block" data-act="gender" data-v="female">Aurat</button></div>';
}
function authView() {
  var signup = ui.authMode === 'signup';
  return '<header class="top">' + (signup ? 'Naya account' : 'Login') + '</header><div class="wrap">' +
    '<label class="f">Email</label><input type="email" data-a="email" autocomplete="email" value="' + esc(authForm.email) + '">' +
    '<label class="f">Password (kam az kam 6 harf)</label><input type="password" data-a="pass" autocomplete="' + (signup ? 'new-password' : 'current-password') + '" value="' + esc(authForm.pass) + '">' +
    (signup ?
      '<label class="f">Aap kaun hain?</label>' +
      '<label class="opt"><input type="radio" name="g" data-a="gender" value="male"' + (authForm.gender === 'male' ? ' checked' : '') + '> Mard</label>' +
      '<label class="opt"><input type="radio" name="g" data-a="gender" value="female"' + (authForm.gender === 'female' ? ' checked' : '') + '> Aurat</label>' : '') +
    (ui.msg ? '<div class="err">' + esc(ui.msg) + '</div>' : '') +
    '<button class="btn block" data-act="auth-go"' + (ui.busy ? ' disabled' : '') + '>' + (ui.busy ? 'Intezar...' : (signup ? 'Account banayein' : 'Login karein')) + '</button>' +
    '<button class="btn link block" data-act="auth-switch">' + (signup ? 'Pehle se account hai? Login' : 'Naya account banayein') + '</button>' +
    '<button class="btn link block" data-act="auth-back">Wapas</button></div>';
}
function numField(label, key, step) {
  return '<label class="f">' + label + '</label><input type="number" inputmode="decimal" ' + (step ? 'step="' + step + '" ' : '') + 'data-f="' + key + '" value="' + esc(form[key]) + '">';
}
function setupView() {
  var f = form, h = '';
  h += '<header class="top">Qaza ka hisab</header><div class="wrap">';
  if (d.setupDone) h += '<button class="btn link" data-act="setup-back">&larr; Wapas</button>';
  h += '<h2>Hisab ka tareeqa</h2><div class="chips">' +
    '<button class="chip' + (f.byAge ? ' on' : '') + '" data-act="mode" data-v="age">Baligh hone ki umar se</button>' +
    '<button class="chip' + (!f.byAge ? ' on' : '') + '" data-act="mode" data-v="years">Saalon ke andaze se</button></div>';
  if (f.byAge) {
    h += numField('Baligh hone ki umar (saal)', 'bulugh', 'any') + numField('Aaj ki umar (saal)', 'age', 'any') +
      numField('Kitne saal namaz regular parhi (agar koi)', 'prayed', 'any');
  } else {
    h += numField('Kitne saal ki qaza hai (andaza)', 'years', 'any');
  }
  if (female()) {
    h += '<h2>Aurat ke liye (ye din minus honge)</h2>' +
      numField('Har mahine haiz ke din (apni aadat)', 'haiz') + numField('Bachon ki tadaad (nifas ke liye)', 'children') +
      numField('Har bache par nifas ke din', 'nifas');
  }
  h += '<label class="opt"><input type="checkbox" data-f="roza"' + (f.roza ? ' checked' : '') + '> Qaza roze ka hisab bhi karein</label>';
  h += '<button class="btn block" data-act="compute">Hisab karein</button>';
  h += '<button class="btn link block" data-act="manual">Hisab chhor kar khud ginti likhein</button>';
  if (f.computed) {
    h += '<h2>Nateeja (aap badal sakte hain)</h2>';
    PK.forEach(function (k) {
      h += '<label class="f">' + PN[k] + ' ki qaza</label><input type="number" inputmode="numeric" data-r="' + k + '" value="' + esc(f.res[k]) + '">';
    });
    h += '<label class="f">Qaza roze</label><input type="number" inputmode="numeric" data-f="rozaRes" value="' + esc(f.rozaRes) + '">';
    h += '<p class="muted">Hisab: 1 saal = 365 din, Ramadan = 30 roze (ehtiyat ke taur par). Aurat ke roze mein sirf haiz minus hota hai. Nifas wagaira ke masail mufti ya aalim se pooch lein.</p>';
    h += '<button class="btn block" data-act="save-setup">Save karein</button>';
  }
  return h + '</div>';
}
function rowHtml(title, left, doneAct, undoAct, k) {
  var kk = k ? ' data-k="' + k + '"' : '';
  return '<div class="card row"><div class="grow"><div class="t">' + title + '</div><div class="s">Baqi: ' + left + '</div></div>' +
    '<button class="ico" data-act="' + undoAct + '"' + kk + ' title="Galti se ghat gayi to ek wapas jama karein" aria-label="Ek wapas jama karein">+</button>' +
    '<button class="btn tonal" data-act="' + doneAct + '"' + kk + (left > 0 ? '' : ' disabled') + '>Parh li</button></div>';
}
function qazaTab() {
  var left = totalLeft(), est;
  if (left <= 0) est = 'Alhamdulillah, saari qaza namaz poori!';
  else {
    var rate = avgPerDay() > 0 ? avgPerDay() : target();
    var days = Math.ceil(left / rate);
    var end = new Date(Date.now() + days * 86400000);
    est = 'Is raftaar se takriban ' + days + ' din (' + end.getDate() + '/' + (end.getMonth() + 1) + '/' + end.getFullYear() + ')';
  }
  var h = '<div class="card"><div class="s">Baqi qaza namaz</div><div class="big">' + left + '</div>' +
    '<div class="bar"><i style="width:' + (progress() * 100).toFixed(1) + '%"></i></div>' +
    '<div>Ab tak poori: ' + Math.max(0, totalInitial() - left) + ' (' + (progress() * 100).toFixed(1) + '%)</div>' +
    '<div>Aaj parhi: ' + todayDone() + ' / ' + target() + '</div><div class="muted">' + est + '</div></div>';
  h += '<h2>Namaz</h2>';
  PK.forEach(function (k) { h += rowHtml(PN[k], pr(k), 'done', 'undo', k); });
  h += '<h2>Roza</h2>' + rowHtml('Qaza roze', n(d.roza), 'roza-done', 'roza-undo', '');
  return h;
}
function auqatTab() {
  var h = '<div class="card"><div class="t">' + (d.lat == null ? 'Location set nahi hai' : 'Location: ' + esc(d.city || 'GPS location')) + '</div>' +
    '<button class="btn block" data-act="gps">GPS se location lein</button>' +
    '<select id="citySel"><option value="">Ya shehar chunein</option>' +
    Object.keys(CITIES).map(function (c) { return '<option' + (d.city === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
    '</select></div>';
  var times = timesFor(new Date());
  if (times.length) {
    h += '<div class="card"><div id="nextp" class="muted" style="margin:0 0 6px">' + esc(nextText()) + '</div>';
    times.forEach(function (t) {
      h += '<div class="tl' + (t.pr ? ' p' : '') + '"><span>' + t.name + '</span><span>' + (t.pr ? '<b>' : '') + fmtTime(t.time) + (t.pr ? '</b>' : '') + '</span></div>';
    });
    h += '</div>';
  }
  h += '<div class="card"><label class="opt"><input type="checkbox" id="remindSw"' + (remindOn() ? ' checked' : '') + '> Har namaz par qaza ki yaad dehani</label>' +
    '<button class="btn line block" data-act="test-remind">Reminder test karein</button>' +
    '<p class="muted">Dhyan dein: browser wali app mein reminder tab bajta hai jab app khuli ho (ya phone par background mein chal rahi ho). App band hone par reminder ke liye Android APK banani paregi.</p></div>' +
    '<p class="muted">Auqat Karachi method aur Hanafi Asr se hisab hote hain (internet ke baghair).</p>';
  return h;
}
function settingsTab() {
  var h = '<div class="card"><div class="t">Account</div>';
  if (!sb) h += '<p class="muted">Online account abhi on nahi. Data sirf is browser mein hai.</p>';
  else if (user) {
    h += '<p>Login: ' + esc(user.email || '') + '</p><div class="row">' +
      '<button class="btn line" data-act="sync">Abhi sync karein</button>' +
      '<button class="btn link" data-act="logout">Logout</button></div>';
  } else {
    h += '<p class="muted">Abhi data sirf is browser mein hai. Account se online save hoga aur doosre phone par bhi mil sakta hai.</p>' +
      '<button class="btn block" data-act="auth-login">Login / Sign up</button>';
  }
  h += '</div><div class="card">' +
    '<button class="btn line block" data-act="setup-open">Dobara hisab / ginti badlein</button>' +
    '<div class="row" style="margin-top:6px"><div class="grow">Roz ka target: <b>' + target() + '</b> namaz</div>' +
    '<button class="ico" data-act="tgt-minus" aria-label="Kam">&minus;</button><button class="ico" data-act="tgt-plus" aria-label="Zyada">+</button></div>' +
    '<p>Aap: ' + (female() ? 'Aurat' : 'Mard') + '</p></div>';
  h += '<div class="card"><div class="t">Phone par app ki tarah</div>' +
    (installEvt ? '<button class="btn block" data-act="install">App install karein</button>' : '') +
    '<p class="muted">Chrome ke menu (&#8942;) mein "Install app" ya "Add to Home screen" dabayein. Phir ye app ki tarah khulegi aur offline bhi chalegi.</p></div>';
  h += '<p class="muted">Ye app sirf hisab rakhne mein madad deti hai. Hanafi fiqh ke mutabiq witr shamil hai. Masail ke liye apne mufti ya aalim se rujoo karein.</p>';
  return h;
}
function homeView() {
  var body = ui.tab === 0 ? qazaTab() : ui.tab === 1 ? auqatTab() : settingsTab();
  var names = ['Qaza', 'Auqat', 'Settings'];
  return '<header class="top">Qaza Tracker</header><div class="wrap">' + body + '</div><nav class="tabs">' +
    names.map(function (nm, i) { return '<button data-act="tab" data-v="' + i + '" class="' + (ui.tab === i ? 'on' : '') + '">' + nm + '</button>'; }).join('') + '</nav>';
}
function view() {
  if (ui.view === 'auth') return authView();
  if (!d.gender) return (ui.view === 'gender' || user) ? genderView() : welcomeView();
  if (!d.setupDone || ui.view === 'setup') return setupView();
  return homeView();
}
function render() {
  var app = document.getElementById('app');
  if (!app) return;
  var y = window.scrollY;
  app.innerHTML = view();
  window.scrollTo(0, y);
}

// ---------- events ----------
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  var a = el.getAttribute('data-act'), v = el.getAttribute('data-v'), k = el.getAttribute('data-k');
  switch (a) {
    case 'auth-signup': ui.view = 'auth'; ui.authMode = 'signup'; ui.msg = ''; render(); break;
    case 'auth-login': ui.view = 'auth'; ui.authMode = 'login'; ui.msg = ''; render(); break;
    case 'auth-switch': ui.authMode = ui.authMode === 'signup' ? 'login' : 'signup'; ui.msg = ''; render(); break;
    case 'auth-back': ui.view = 'home'; ui.msg = ''; render(); break;
    case 'auth-go': doAuth(); break;
    case 'start-local': ui.view = 'gender'; render(); break;
    case 'gender': d.gender = v; ui.view = 'home'; save(); break;
    case 'mode': form.byAge = v === 'age'; render(); break;
    case 'compute': computeForm(); render(); break;
    case 'manual': form.computed = true; render(); break;
    case 'save-setup': saveSetup(); break;
    case 'setup-back': ui.view = 'home'; render(); break;
    case 'setup-open': openSetup(); break;
    case 'tab': ui.tab = Number(v); render(); window.scrollTo(0, 0); break;
    case 'done': changePrayer(k, -1); break;
    case 'undo': changePrayer(k, 1); break;
    case 'roza-done': changeRoza(-1); break;
    case 'roza-undo': changeRoza(1); break;
    case 'gps': useGps(); break;
    case 'test-remind':
      askNotifPermission().then(function () { fireReminder('Test: namaz ka waqt', 'Reminder theek kaam kar raha hai.'); });
      break;
    case 'tgt-minus': d.target = Math.max(1, target() - 1); save(); break;
    case 'tgt-plus': d.target = target() + 1; save(); break;
    case 'sync': pushCloud().then(function (m) { toast(m || 'Online save ho gaya.'); }); break;
    case 'logout': doLogout(); break;
    case 'install':
      if (installEvt) { installEvt.prompt(); installEvt = null; render(); }
      break;
  }
});
document.addEventListener('input', function (e) {
  var t = e.target;
  if (t.type === 'checkbox' || t.type === 'radio') return;
  if (t.dataset.f) form[t.dataset.f] = t.value;
  else if (t.dataset.r) form.res[t.dataset.r] = t.value;
  else if (t.dataset.a) authForm[t.dataset.a] = t.value;
});
document.addEventListener('change', function (e) {
  var t = e.target;
  if (t.dataset.f && t.type === 'checkbox') { form[t.dataset.f] = t.checked; }
  else if (t.dataset.a === 'gender') { authForm.gender = t.value; }
  else if (t.id === 'citySel') {
    var c = CITIES[t.value];
    if (c) { d.city = t.value; d.lat = c[0]; d.lng = c[1]; save(); scheduleTimers(); }
  } else if (t.id === 'remindSw') {
    d.remind = t.checked;
    save();
    if (t.checked) askNotifPermission();
    scheduleTimers();
  }
});
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; });
document.addEventListener('visibilitychange', function () { if (!document.hidden) scheduleTimers(); });
setInterval(function () {
  var el = document.getElementById('nextp');
  if (el) el.textContent = nextText();
}, 30000);
setInterval(scheduleTimers, 6 * 3600 * 1000);

// ---------- start ----------
render();
scheduleTimers();
if (sb) afterLogin();
})();
