// ════════════════════════════════════════════════════════
//  CLOUD  —  js/cloud.js   (Firebase: Google sign-in + Firestore only)
//  Exposes window.Cloud for the other scripts.
//  Sign-in uses the pop-up only. (The old full-page redirect fallback fails on
//  many phones and in WhatsApp/TikTok browsers, which caused the sign-in loop.)
// ════════════════════════════════════════════════════════
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence,
  browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup,
  onAuthStateChanged, signOut as fbSignOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const cfg = window.APP_CONFIG;
const app = initializeApp(cfg.FIREBASE);
const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
  popupRedirectResolver: browserPopupRedirectResolver
});
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const state = { user: null, profile: null, error: null };
const CHUNK_CHARS = 700000;           // Firestore docs max ~1 MiB, so files are split
const chunkId = i => String(i).padStart(3, '0');
const uid = () => { if (!auth.currentUser) throw new Error('Not signed in'); return auth.currentUser.uid; };
const wait = ms => new Promise(r => setTimeout(r, ms));

function emit() {
  if (typeof window.onAuthState === 'function') {
    window.onAuthState({ user: state.user, profile: state.profile, error: state.error });
  }
}

async function ensureProfile(user) {
  const ref = doc(db, 'users', user.uid);
  let snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      email: user.email, name: user.displayName || '', photo: user.photoURL || '',
      plan: 'free', premiumUntil: null,
      createdAt: serverTimestamp(), lastLogin: serverTimestamp()
    });
  } else {
    await updateDoc(ref, {
      lastLogin: serverTimestamp(), name: user.displayName || '', photo: user.photoURL || ''
    });
  }
  snap = await getDoc(ref);
  return snap.data();
}

// Try a few times (bad network); stop straight away if the rules refuse.
async function ensureProfileWithRetry(user) {
  let last;
  for (let i = 0; i < 3; i++) {
    try { return await ensureProfile(user); }
    catch (e) {
      last = e;
      if (e && e.code === 'permission-denied') break;
      await wait(700 * (i + 1));
    }
  }
  throw last;
}

onAuthStateChanged(auth, async user => {
  state.user = user; state.error = null;
  if (!user) { state.profile = null; emit(); return; }
  try { state.profile = await ensureProfileWithRetry(user); }
  catch (e) { console.error('Profile error:', e); state.profile = null; state.error = e; }
  emit();
});

async function retryProfile() {
  if (!auth.currentUser) return;
  state.error = null;
  try { state.profile = await ensureProfileWithRetry(auth.currentUser); }
  catch (e) { console.error('Profile error:', e); state.error = e; }
  emit();
  return !state.error;
}

// Pop-up only. Errors are thrown so account.js can explain them to the person.
async function signIn() { await signInWithPopup(auth, provider); }
const signOut = () => fbSignOut(auth);

async function refreshProfile() {
  if (!auth.currentUser) return null;
  const snap = await getDoc(doc(db, 'users', auth.currentUser.uid));
  state.profile = snap.exists() ? snap.data() : null;
  emit();
  return state.profile;
}

async function savePhoto(dataUrl) {
  await updateDoc(doc(db, 'users', uid()), { customPhoto: dataUrl });
  if (state.profile) state.profile.customPhoto = dataUrl;
  emit();
}

// ── Course backup ──
async function loadLevels() {
  const s = await getDoc(doc(db, 'users', uid(), 'data', 'levels'));
  return s.exists() ? s.data() : null;
}
async function saveLevels(json, updatedAt) {
  await setDoc(doc(db, 'users', uid(), 'data', 'levels'), { json, updatedAt });
}

// ── Result files (stored in Firestore as base64 chunks) ──
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

// ── Payment claim (tells the admin panel someone tapped "I've paid") ──
async function claimPayment() {
  const u = auth.currentUser;
  await setDoc(doc(db, 'claims', u.uid), {
    email: u.email, name: u.displayName || '', status: 'pending', createdAt: serverTimestamp()
  });
}

window.Cloud = {
  signIn, signOut, refreshProfile, retryProfile, savePhoto, loadLevels, saveLevels,
  listFiles, putFile, getFileB64, deleteFile, claimPayment,
  getState: () => ({ ...state })
};
window.dispatchEvent(new Event('cloud-ready'));
