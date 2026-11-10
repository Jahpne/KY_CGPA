// ════════════════════════════════════════════════════════
//  ADMIN PANEL  —  js/admin.js   (open at /admin)
//  Only the ADMIN_EMAIL Google account can read the user list.
//  This is enforced by firestore.rules, not just by this page.
// ════════════════════════════════════════════════════════
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence,
  browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup,
  onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, getDocs, doc, updateDoc, setDoc, deleteDoc,
  Timestamp, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import './config.js';

const CFG = window.APP_CONFIG;
const app = initializeApp(CFG.FIREBASE);
const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
  popupRedirectResolver: browserPopupRedirectResolver
});
const db = getFirestore(app);
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let users = [], claims = {}, filter = 'all', query = '';

// ── boot lines (one typed moment, skipped if reduced motion) ──
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
function typeBoot(lines) {
  const el = $('boot');
  return new Promise(resolve => {
    if (reduce) { el.innerHTML = lines.join('\n'); el.classList.remove('cursor'); resolve(); return; }
    let i = 0; el.innerHTML = '';
    (function next() {
      if (i >= lines.length) { el.classList.remove('cursor'); resolve(); return; }
      el.innerHTML += (i ? '\n' : '') + lines[i++];
      setTimeout(next, 260);
    })();
  });
}

const ms = t => (t && t.toMillis ? t.toMillis() : 0);
const fmt = t => (t ? new Date(typeof t === 'number' ? t : ms(t)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
function ago(t) {
  const m = ms(t); if (!m) return '—';
  const d = Math.floor((Date.now() - m) / 60000);
  if (d < 1) return 'just now'; if (d < 60) return d + 'm ago';
  if (d < 1440) return Math.floor(d / 60) + 'h ago';
  return Math.floor(d / 1440) + 'd ago';
}
function statusOf(u) {
  if (!u.premiumUntil) return 'free';
  return ms(u.premiumUntil) > Date.now() ? 'premium' : 'expired';
}
function log(msg) {
  const l = $('log');
  const d = document.createElement('div');
  d.innerHTML = `[${new Date().toLocaleTimeString()}] <b>&gt;</b> ${esc(msg)}`;
  l.prepend(d);
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

typeBoot([
  '<b>&gt;</b> booting grade-pilot admin…',
  '<b>&gt;</b> linking to project <b>' + esc(CFG.FIREBASE.projectId) + '</b>',
  '<b>&gt;</b> awaiting credentials'
]).then(() => { bootDone = true; maybeShow(); });

let bootDone = false, authState = undefined;
onAuthStateChanged(auth, user => { authState = user || null; maybeShow(); });

function show(which) {
  ['login', 'denied', 'panel'].forEach(id => $(id).classList.toggle('hide', id !== which));
}
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

// ── data ──
async function load() {
  $('rows').innerHTML = '<div class="empty cursor">&gt; fetching users</div>';
  try {
    const [us, cs] = await Promise.all([getDocs(collection(db, 'users')), getDocs(collection(db, 'claims'))]);
    users = us.docs.map(d => ({ uid: d.id, ...d.data() }));
    claims = {}; cs.docs.forEach(d => (claims[d.id] = d.data()));
    // someone who tapped "I've paid" but has no profile record still shows up here
    Object.keys(claims).forEach(id => {
      if (!users.find(u => u.uid === id)) {
        users.push({ uid: id, email: claims[id].email, name: claims[id].name, createdAt: claims[id].createdAt, lastLogin: claims[id].createdAt, premiumUntil: null, _orphan: true });
      }
    });
    users.sort((a, b) => (claims[b.uid] ? 1 : 0) - (claims[a.uid] ? 1 : 0) || ms(b.lastLogin) - ms(a.lastLogin));
    log(`loaded ${users.length} user(s), ${Object.keys(claims).length} payment notice(s)`);
    render();
  } catch (e) {
    console.error(e);
    $('rows').innerHTML = `<div class="empty" style="color:var(--bad)">&gt; read failed: ${esc(e.code || e.message)}<br>&gt; did you publish firestore.rules? (see SETUP.md)</div>`;
  }
}

function visible() {
  const q = query.trim().toLowerCase();
  return users.filter(u => {
    const st = statusOf(u);
    if (filter === 'premium' && st !== 'premium') return false;
    if (filter === 'expired' && st !== 'expired') return false;
    if (filter === 'free' && st !== 'free') return false;
    if (filter === 'claims' && !claims[u.uid]) return false;
    if (!q) return true;
    return (u.email || '').toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q);
  });
}

function render() {
  const total = users.length;
  const prem = users.filter(u => statusOf(u) === 'premium').length;
  const pend = Object.keys(claims).length;
  const week = users.filter(u => Date.now() - ms(u.createdAt) < 7 * 864e5).length;
  $('stats').innerHTML = `
    <div class="stat"><div class="n">${total}</div><div class="l">users</div></div>
    <div class="stat"><div class="n">${prem}</div><div class="l">premium now</div></div>
    <div class="stat ${pend ? 'alert' : ''}"><div class="n">${pend}</div><div class="l">paid, waiting</div></div>
    <div class="stat"><div class="n">${week}</div><div class="l">joined 7 days</div></div>`;

  const chips = [['all', 'all'], ['claims', 'paid-waiting'], ['premium', 'premium'], ['expired', 'expired'], ['free', 'free']];
  $('chips').innerHTML = chips.map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('');
  $('chips').querySelectorAll('.chip').forEach(b => (b.onclick = () => { filter = b.dataset.f; render(); }));

  const list = visible();
  if (!list.length) { $('rows').innerHTML = '<div class="empty">&gt; no matches</div>'; return; }
  $('rows').innerHTML = list.map(u => {
    const st = statusOf(u), c = claims[u.uid];
    const noRec = u._orphan ? `<span class="tag claim">no profile record yet</span>` : '';
    const tag = st === 'premium' ? `<span class="tag prem">premium · until ${fmt(u.premiumUntil)}</span>`
      : st === 'expired' ? `<span class="tag exp">expired ${fmt(u.premiumUntil)}</span>` : `<span class="tag">free</span>`;
    return `
    <div class="row ${c ? 'claim' : ''}">
      <div class="top">
        <div><div class="mail">${esc(u.email)}</div><div class="nm">${esc(u.name || '')}</div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${noRec}${c ? `<span class="tag claim">paid? · ${fmt(c.createdAt)}</span>` : ''}${tag}</div>
      </div>
      <div class="meta"><span>joined ${fmt(u.createdAt)}</span><span>last seen ${ago(u.lastLogin)}</span></div>
      <div class="acts">
        <button class="btn" data-a="grant" data-u="${esc(u.uid)}">+1 year</button>
        <button class="btn bad" data-a="revoke" data-u="${esc(u.uid)}" ${st === 'free' || u._orphan ? 'disabled' : ''}>revoke</button>
        ${c ? `<button class="btn dim" data-a="dismiss" data-u="${esc(u.uid)}">dismiss notice</button>` : ''}
        <a class="btn dim" style="text-decoration:none" href="mailto:${esc(u.email)}">email</a>
      </div>
    </div>`;
  }).join('');
  $('rows').querySelectorAll('button[data-a]').forEach(b => (b.onclick = () => act(b.dataset.a, b.dataset.u, b)));
}

async function act(kind, uid, btn) {
  const u = users.find(x => x.uid === uid); if (!u) return;
  try {
    btn.disabled = true;
    if (kind === 'grant') {
      if (!confirm(`Give ${u.email} premium for ${CFG.PREMIUM_DAYS} days?`)) { btn.disabled = false; return; }
      const base = Math.max(Date.now(), ms(u.premiumUntil));
      const until = Timestamp.fromMillis(base + CFG.PREMIUM_DAYS * 864e5);
      const grant = { plan: 'premium', premiumUntil: until, grantedAt: serverTimestamp(), grantedBy: auth.currentUser.email };
      if (u._orphan) {
        // create the missing profile record for this person, with premium already on
        await setDoc(doc(db, 'users', uid), { email: u.email, name: u.name || '', photo: '', createdAt: serverTimestamp(), lastLogin: serverTimestamp(), ...grant });
        u._orphan = false;
      } else {
        await updateDoc(doc(db, 'users', uid), grant);
      }
      if (claims[uid]) { await deleteDoc(doc(db, 'claims', uid)); delete claims[uid]; }
      u.plan = 'premium'; u.premiumUntil = until;
      log(`granted ${u.email} until ${fmt(until)}`);
    } else if (kind === 'revoke') {
      if (!confirm(`Remove premium from ${u.email}? Their saved files stay but they go back to the free plan.`)) { btn.disabled = false; return; }
      await updateDoc(doc(db, 'users', uid), { plan: 'free', premiumUntil: null });
      u.plan = 'free'; u.premiumUntil = null;
      log(`revoked ${u.email}`);
    } else if (kind === 'dismiss') {
      await deleteDoc(doc(db, 'claims', uid)); delete claims[uid];
      log(`dismissed notice for ${u.email}`);
    }
    render();
  } catch (e) {
    console.error(e); btn.disabled = false;
    log('FAILED: ' + (e.code || e.message));
    alert('Action failed: ' + (e.code || e.message));
  }
}

// ── tools ──
const emails = () => visible().map(u => u.email).filter(Boolean);
$('q').oninput = e => { query = e.target.value; render(); };
$('btn-copy').onclick = async () => {
  const list = emails().join(', ');
  try { await navigator.clipboard.writeText(list); log(`copied ${emails().length} email(s)`); }
  catch { prompt('Copy these emails:', list); }
};
$('btn-mail').onclick = () => {
  const list = emails();
  if (!list.length) return;
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
  const rows = visible().map(u => [u.email, u.name, statusOf(u), u.premiumUntil ? fmt(u.premiumUntil) : '', fmt(u.createdAt), fmt(u.lastLogin)]);
  const csv = [head, ...rows].map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'grade-pilot-users.csv';
  a.click();
  log(`exported ${rows.length} row(s)`);
};
