// ════════════════════════════════════════════════════════
//  CLOUD  —  js/cloud.js   (Firebase: Google sign-in + Firestore only)
//  Exposes window.Cloud for the other scripts.
//
//  Built for weak networks:
//   • The app never waits for the database. It starts from what the phone remembers.
//   • Sign-ups are WRITE-ONLY (no read first), and the database queues the write on the
//     phone and sends it when the connection allows.
//   • Premium is looked up by the person's email (grants/{email}), so the admin can
//     give access to any email he sees, even if that person's profile never saved.
// ════════════════════════════════════════════════════════
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence,
  browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup,
  onAuthStateChanged, signOut as fbSignOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, deleteDoc, collection, getDocs, serverTimestamp, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const cfg = window.APP_CONFIG;
const app = initializeApp(cfg.FIREBASE);
const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
  popupRedirectResolver: browserPopupRedirectResolver
});

// Offline cache + long-polling (the streaming connection is blocked or unstable on many
// mobile networks, which showed up as "unavailable").
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    experimentalForceLongPolling: true
  });
} catch (e) {
  console.warn('Offline cache unavailable, using normal mode', e);
  db = getFirestore(app);
}

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const state = { user: null, profile: null, error: null, pending: false };
const CHUNK_CHARS = 700000;
const chunkId = i => String(i).padStart(3, '0');
const uid = () => { if (!auth.currentUser) throw new Error('Not signed in'); return auth.currentUser.uid; };
const emailKey = u => String((u && u.email) || '').toLowerCase();
const wait = ms => new Promise(r => setTimeout(r, ms));
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'unavailable' })), ms))
  ]);
}

function emit() {
  if (typeof window.onAuthState === 'function') {
    window.onAuthState({ user: state.user, profile: state.profile, error: state.error, pending: state.pending });
  }
}

// ── what the phone remembers about this person (their plan) ──
const PKEY = id => 'gp_profile_' + id;
const fakeTs = ms => ({ toDate: () => new Date(ms), toMillis: () => ms });
function readMemory(id) { try { return JSON.parse(localStorage.getItem(PKEY(id)) || 'null') || {}; } catch (e) { return {}; } }
function writeMemory(id, patch) {
  try { localStorage.setItem(PKEY(id), JSON.stringify({ ...readMemory(id), ...patch })); } catch (e) {}
}
function profileFromMemory(user) {
  const m = readMemory(user.uid);
  return {
    email: user.email, name: user.displayName || '',
    premiumUntil: m.premiumMs ? fakeTs(m.premiumMs) : null,
    _provisional: true
  };
}

// ── record the sign-in: write only, no read first, queued when the network is weak ──
function recordSignIn(user) {
  try {
    // once every 6 hours is plenty (keeps the free daily write limit safe)
    const k = 'gp_rec_' + user.uid;
    if (Date.now() - (Number(localStorage.getItem(k)) || 0) < 6 * 3600e3) return;
    const created = user.metadata && user.metadata.creationTime ? Date.parse(user.metadata.creationTime) : NaN;
    const data = {
      uid: user.uid, email: user.email, name: user.displayName || '',
      lastLogin: serverTimestamp()
    };
    if (!isNaN(created)) data.joined = Timestamp.fromMillis(created);
    setDoc(doc(db, 'signups', user.uid), data, { merge: true })
      .then(() => { try { localStorage.setItem(k, String(Date.now())); } catch (e) {} })
      .catch(e => console.warn('signup record', e && e.code));
  } catch (e) { console.warn(e); }
}

// ── premium: looked up by email ──
let retryTimer = null, retries = 0;
async function syncPlan(user) {
  clearTimeout(retryTimer);
  try {
    const snap = await withTimeout(getDoc(doc(db, 'grants', emailKey(user))), 10000);
    if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
    const until = snap.exists() ? snap.data().premiumUntil : null;
    state.profile = {
      ...(state.profile || profileFromMemory(user)),
      premiumUntil: until || null, _provisional: false
    };
    state.error = null; state.pending = false; retries = 0;
    writeMemory(user.uid, { premiumMs: until && until.toMillis ? until.toMillis() : 0 });
    emit();
  } catch (e) {
    if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
    if (e && e.code === 'permission-denied') { state.error = e; state.pending = false; emit(); return; }
    // weak or no network: stay quiet, keep what the phone remembers, try again later
    state.pending = true; emit();
    if (++retries <= 40) retryTimer = setTimeout(() => syncPlan(user), Math.min(60000, 4000 * retries));
  }
}
window.addEventListener('online', () => { if (auth.currentUser && state.pending) syncPlan(auth.currentUser); });

onAuthStateChanged(auth, user => {
  state.user = user; state.error = null;
  if (!user) { clearTimeout(retryTimer); state.profile = null; state.pending = false; emit(); return; }
  state.profile = profileFromMemory(user);
  state.pending = true;
  emit();                    // the app opens right now, from what the phone remembers
  recordSignIn(user);        // queued write
  syncPlan(user);            // quiet background check
});

async function retryProfile() {
  if (!auth.currentUser) return false;
  retries = 0;
  await syncPlan(auth.currentUser);
  return !state.error && !state.pending;
}
async function refreshProfile() { return retryProfile(); }

// Pop-up only. Errors are thrown so account.js can explain them to the person.
async function signIn() { await signInWithPopup(auth, provider); }
const signOut = () => fbSignOut(auth);

// ── Course backup ──
async function loadLevels() {
  const s = await getDoc(doc(db, 'users', uid(), 'data', 'levels'));
  return s.exists() ? s.data() : null;
}
// returns 'saved' once confirmed, or 'queued' if the network is slow
async function saveLevels(json, updatedAt) {
  const done = setDoc(doc(db, 'users', uid(), 'data', 'levels'), { json, updatedAt }).then(() => 'saved');
  return Promise.race([done, wait(15000).then(() => 'queued')]);
}

// ── Result files (Firestore, base64 chunks) ──
async function listFiles() {
  const s = await getDocs(collection(db, 'users', uid(), 'files'));
  return s.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function putFile(meta, b64, onProgress) {
  const u = uid();
  const n = Math.max(1, Math.ceil(b64.length / CHUNK_CHARS));
  const written = [];
  try {
    for (let i = 0; i < n; i++) {
      await setDoc(doc(db, 'users', u, 'files', meta.id, 'chunks', chunkId(i)), {
        i, data: b64.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS)
      });
      written.push(i);
      if (onProgress) onProgress((i + 1) / n);
    }
    await setDoc(doc(db, 'users', u, 'files', meta.id), { ...meta, chunks: n, uploadedAt: serverTimestamp() });
  } catch (e) {
    for (const i of written) { try { await deleteDoc(doc(db, 'users', u, 'files', meta.id, 'chunks', chunkId(i))); } catch (_) {} }
    throw e;
  }
  return n;
}
async function getFileB64(meta) {
  const u = uid();
  const parts = await Promise.all(
    Array.from({ length: meta.chunks || 1 }, (_, i) => getDoc(doc(db, 'users', u, 'files', meta.id, 'chunks', chunkId(i))))
  );
  return parts.map(p => (p.exists() ? p.data().data : '')).join('');
}
async function deleteFile(meta) {
  const u = uid();
  await deleteDoc(doc(db, 'users', u, 'files', meta.id));
  for (let i = 0; i < (meta.chunks || 1); i++) {
    try { await deleteDoc(doc(db, 'users', u, 'files', meta.id, 'chunks', chunkId(i))); } catch (_) {}
  }
}

// ── "I've paid" notice for the admin (queued when the network is weak) ──
async function claimPayment() {
  const u = auth.currentUser;
  setDoc(doc(db, 'claims', u.uid), {
    uid: u.uid, email: u.email, name: u.displayName || '', status: 'pending', createdAt: serverTimestamp()
  }).catch(e => console.warn('claim', e && e.code));
}

window.Cloud = {
  signIn, signOut, refreshProfile, retryProfile, loadLevels, saveLevels,
  listFiles, putFile, getFileB64, deleteFile, claimPayment,
  getState: () => ({ ...state })
};
window.dispatchEvent(new Event('cloud-ready'));
