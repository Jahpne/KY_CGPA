// ════════════════════════════════════════════════════════
//  ADMIN PANEL  —  js/admin.js   (open at /admin)
//  • Lists everyone who signed in (name + email), who tapped "I've paid",
//    and who has premium.
//  • "Give access by email" works for ANY email, even if that person's own
//    record never reached the database.
//  Only the ADMIN_EMAIL Google account can read this (enforced by firestore.rules).
// ════════════════════════════════════════════════════════
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence,
  browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup,
  onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore,
  collection, getDocs, doc, setDoc, deleteDoc, Timestamp, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import './config.js';

const CFG = window.APP_CONFIG;
const app = initializeApp(CFG.FIREBASE);
const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
  popupRedirectResolver: browserPopupRedirectResolver
});
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    experimentalForceLongPolling: true
  });
} catch (e) { db = getFirestore(app); }

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let people = [], filter = 'all', query = '';

// ── boot lines ──
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
function typeBoot(lines) {
  const el = $('boot');
  return new Promise(resolve => {
    if (reduce) { el.innerHTML = lines.join('\n'); el.classList.remove('cursor'); resolve(); return; }
    let i = 0; el.innerHTML = '';
    (function next() {
      if (i >= lines.length) { el.classList.remove('cursor'); resolve(); return; }
      el.innerHTML += (i ? '\n' : '') + lines[i++];
      setTimeout(next, 180);
    })();
  });
}

const ms = t => (t && t.toMillis ? t.toMillis() : 0);
const fmt = t => {
  const m = typeof t === 'number' ? t : ms(t);
  return m ? new Date(m).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
};
function ago(t) {
  const m = ms(t); if (!m) return '—';
  const d = Math.floor((Date.now() - m) / 60000);
  if (d < 1) return 'just now'; if (d < 60) return d + 'm ago';
  if (d < 1440) return Math.floor(d / 60) + 'h ago';
  return Math.floor(d / 1440) + 'd ago';
}
function statusOf(p) {
  if (!p.premiumUntil) return 'free';
  return ms(p.premiumUntil) > Date.now() ? 'premium' : 'expired';
}
function log(msg) {
  const d = document.createElement('div');
  d.innerHTML = `[${new Date().toLocaleTimeString()}] <b>&gt;</b> ${esc(msg)}`;
  $('log').prepend(d);
}

// ── auth ──
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });
$('btn-login').onclick = async () => {
  $('login-msg').textContent = '';
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (e.code === 'auth/popup-blocked') $('login-msg').textContent = '> pop-up blocked. allow pop-ups for this site (or open in Chrome) and try again.';
    else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request')
      $('login-msg').textContent = '> error: ' + (e.code || e.message);
  }
};
$('btn-out').onclick = $('btn-denied-out').onclick = () => signOut(auth);
$('btn-refresh').onclick = () => load();

let bootDone = false, authState = undefined;
typeBoot([
  '<b>&gt;</b> booting grade-pilot admin…',
  '<b>&gt;</b> linking to project <b>' + esc(CFG.FIREBASE.projectId) + '</b>',
  '<b>&gt;</b> awaiting credentials'
]).then(() => { bootDone = true; maybeShow(); });
onAuthStateChanged(auth, user => { authState = user || null; maybeShow(); });

function show(which) { ['login', 'denied', 'panel'].forEach(id => $(id).classList.toggle('hide', id !== which)); }
function maybeShow() {
  if (!bootDone || authState === undefined) return;
  const user = authState;
  if (!user) return show('login');
  if (!user.email || user.email.toLowerCase() !== CFG.ADMIN_EMAIL.toLowerCase() || !user.emailVerified) {
    $('denied-mail').textContent = user.email || 'this account';
    return show('denied');
  }
  $('who').textContent = 'logged in as ' + user.email;
  show('panel');
  load();
}

// ── data: signups + grants + claims (+ old records from the first version) ──
async function load() {
  $('rows').innerHTML = '<div class="empty cursor">&gt; fetching</div>';
  const names = ['signups', 'grants', 'claims', 'users'];
  const results = await Promise.allSettled(names.map(n => getDocs(collection(db, n))));
  const got = {}; const failed = [];
  results.forEach((r, i) => { if (r.status === 'fulfilled') got[names[i]] = r.value.docs; else { got[names[i]] = []; failed.push(names[i] + ':' + (r.reason && r.reason.code || 'error')); } });

  const map = new Map();
  const get = e => { e = String(e || '').toLowerCase(); if (!e) return null; if (!map.has(e)) map.set(e, { email: e }); return map.get(e); };

  got.users.forEach(d => { const x = d.data(); const r = get(x.email); if (!r) return; r.name = r.name || x.name; r.joined = r.joined || x.createdAt; r.lastLogin = r.lastLogin || x.lastLogin; });
  got.signups.forEach(d => { const x = d.data(); const r = get(x.email); if (!r) return; r.name = x.name || r.name; r.joined = x.joined || r.joined; r.lastLogin = x.lastLogin || r.lastLogin; r.uid = d.id; });
  got.grants.forEach(d => { const x = d.data(); const r = get(d.id); if (r) r.premiumUntil = x.premiumUntil; });
  got.claims.forEach(d => { const x = d.data(); const r = get(x.email); if (r) { r.claim = { ...x, _id: d.id }; r.name = r.name || x.name; } });

  people = [...map.values()];
  people.sort((a, b) => (b.claim ? 1 : 0) - (a.claim ? 1 : 0) || ms(b.lastLogin) - ms(a.lastLogin) || ms(b.joined) - ms(a.joined));
  log(`loaded ${people.length} people` + (failed.length ? ' · could not read: ' + failed.join(', ') + ' (publish firestore.rules?)' : ''));
  render();
}

function visible() {
  const q = query.trim().toLowerCase();
  return people.filter(p => {
    const st = statusOf(p);
    if (filter === 'premium' && st !== 'premium') return false;
    if (filter === 'expired' && st !== 'expired') return false;
    if (filter === 'free' && st !== 'free') return false;
    if (filter === 'claims' && !p.claim) return false;
    if (!q) return true;
    return p.email.includes(q) || (p.name || '').toLowerCase().includes(q);
  });
}

function render() {
  const prem = people.filter(p => statusOf(p) === 'premium').length;
  const pend = people.filter(p => p.claim).length;
  const week = people.filter(p => Date.now() - ms(p.joined) < 7 * 864e5).length;
  $('stats').innerHTML = `
    <div class="stat"><div class="n">${people.length}</div><div class="l">people</div></div>
    <div class="stat"><div class="n">${prem}</div><div class="l">premium now</div></div>
    <div class="stat ${pend ? 'alert' : ''}"><div class="n">${pend}</div><div class="l">paid, waiting</div></div>
    <div class="stat"><div class="n">${week}</div><div class="l">joined 7 days</div></div>`;

  const chips = [['all', 'all'], ['claims', 'paid-waiting'], ['premium', 'premium'], ['expired', 'expired'], ['free', 'free']];
  $('chips').innerHTML = chips.map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('');
  $('chips').querySelectorAll('.chip').forEach(b => (b.onclick = () => { filter = b.dataset.f; render(); }));

  const list = visible();
  if (!list.length) { $('rows').innerHTML = '<div class="empty">&gt; no matches</div>'; return; }
  $('rows').innerHTML = list.map(p => {
    const st = statusOf(p);
    const tag = st === 'premium' ? `<span class="tag prem">premium · until ${fmt(p.premiumUntil)}</span>`
      : st === 'expired' ? `<span class="tag exp">expired ${fmt(p.premiumUntil)}</span>` : `<span class="tag">free</span>`;
    return `
    <div class="row ${p.claim ? 'claim' : ''}">
      <div class="top">
        <div><div class="mail">${esc(p.email)}</div><div class="nm">${esc(p.name || '')}</div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${p.claim ? `<span class="tag claim">paid? · ${fmt(p.claim.createdAt)}</span>` : ''}${tag}</div>
      </div>
      <div class="meta"><span>joined ${fmt(p.joined)}</span><span>last seen ${ago(p.lastLogin)}</span></div>
      <div class="acts">
        <button class="btn" data-a="grant" data-e="${esc(p.email)}">+1 year</button>
        <button class="btn bad" data-a="revoke" data-e="${esc(p.email)}" ${st === 'free' ? 'disabled' : ''}>revoke</button>
        ${p.claim ? `<button class="btn dim" data-a="dismiss" data-e="${esc(p.email)}">dismiss notice</button>` : ''}
        <a class="btn dim" style="text-decoration:none" href="mailto:${esc(p.email)}">email</a>
      </div>
    </div>`;
  }).join('');
  $('rows').querySelectorAll('button[data-a]').forEach(b => (b.onclick = () => act(b.dataset.a, b.dataset.e, b)));
}

// ── actions (all keyed by email) ──
async function grantByEmail(email) {
  const p = people.find(x => x.email === email);
  const base = Math.max(Date.now(), ms(p && p.premiumUntil));
  const until = Timestamp.fromMillis(base + CFG.PREMIUM_DAYS * 864e5);
  await setDoc(doc(db, 'grants', email), { email, premiumUntil: until, grantedAt: serverTimestamp(), grantedBy: auth.currentUser.email }, { merge: true });
  return until;
}
async function act(kind, email, btn) {
  const p = people.find(x => x.email === email); if (!p) return;
  try {
    btn.disabled = true;
    if (kind === 'grant') {
      if (!confirm(`Give ${email} premium for ${CFG.PREMIUM_DAYS} days?`)) { btn.disabled = false; return; }
      p.premiumUntil = await grantByEmail(email);
      if (p.claim && p.claim._id) { try { await deleteDoc(doc(db, 'claims', p.claim._id)); p.claim = null; } catch (e) {} }
      log(`granted ${email} until ${fmt(p.premiumUntil)}`);
    } else if (kind === 'revoke') {
      if (!confirm(`Remove premium from ${email}? Their saved files stay; uploads pause.`)) { btn.disabled = false; return; }
      await deleteDoc(doc(db, 'grants', email));
      p.premiumUntil = null;
      log(`revoked ${email}`);
    } else if (kind === 'dismiss') {
      const id = p.claim && p.claim._id;
      if (id) await deleteDoc(doc(db, 'claims', id));
      p.claim = null;
      log(`dismissed notice for ${email}`);
    }
    render();
  } catch (e) {
    console.error(e); btn.disabled = false;
    log('FAILED: ' + (e.code || e.message));
    alert('That did not go through: ' + (e.code || e.message));
  }
}

// give access to any email, even one that is not in the list yet
$('btn-addgrant').onclick = async () => {
  const email = $('grant-email').value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('Type a full email address.'); return; }
  if (!confirm(`Give ${email} premium for ${CFG.PREMIUM_DAYS} days?`)) return;
  try {
    const until = await grantByEmail(email);
    if (!people.find(x => x.email === email)) people.unshift({ email, premiumUntil: until });
    else people.find(x => x.email === email).premiumUntil = until;
    $('grant-email').value = '';
    log(`granted ${email} until ${fmt(until)}`);
    render();
  } catch (e) { log('FAILED: ' + (e.code || e.message)); alert('That did not go through: ' + (e.code || e.message)); }
};

// ── tools ──
const emails = () => visible().map(p => p.email);
$('q').oninput = e => { query = e.target.value; render(); };
$('btn-copy').onclick = async () => {
  const list = emails().join(', ');
  try { await navigator.clipboard.writeText(list); log(`copied ${emails().length} email(s)`); }
  catch { prompt('Copy these emails:', list); }
};
$('btn-mail').onclick = () => {
  const list = emails(); if (!list.length) return;
  const url = 'mailto:?bcc=' + encodeURIComponent(list.join(',')) + '&subject=' + encodeURIComponent('Grade Pilot update');
  if (url.length > 1900) {
    navigator.clipboard && navigator.clipboard.writeText(list.join(', '));
    alert('Too many people for a mail link. Emails are copied. Paste them into BCC in Gmail.');
    return;
  }
  location.href = url;
};
$('btn-csv').onclick = () => {
  const head = ['email', 'name', 'status', 'premium_until', 'joined', 'last_login'];
  const rows = visible().map(p => [p.email, p.name, statusOf(p), p.premiumUntil ? fmt(p.premiumUntil) : '', fmt(p.joined), fmt(p.lastLogin)]);
  const csv = [head, ...rows].map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'grade-pilot-users.csv';
  a.click();
  log(`exported ${rows.length} row(s)`);
};
