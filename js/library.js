// ════════════════════════════════════════════════════════
//  RESULT LIBRARY  —  js/library.js
//  Free plan : files stay in this browser (IndexedDB), up to FREE_LOCAL_MAX_FILES.
//  Premium   : files are compressed and saved to the user's account (Firestore),
//              up to PREMIUM_MAX_PER_SEMESTER per level + semester.
//  Expired   : existing files can still be opened/downloaded; uploads are locked.
// ════════════════════════════════════════════════════════

const LIBCFG = window.APP_CONFIG;
const PIN_STORAGE_KEY       = 'sabigrade_lib_pin';
const RECOVERY_ANSWER_KEY   = 'sabigrade_lib_recovery';
const DEFAULT_PIN           = '1234';
const DEFAULT_RECOVERY_ANSWER = 'my best course';
const SESSION_KEY           = 'sabigrade_lib_unlocked';
const LIB_LEGACY_KEY        = 'sabigrade_lib_files';   // old localStorage storage

let currentLibLevel = 100;       // 100..500 or 'Books'
let currentLibSem   = 1;
let selectedFile    = null;
let libraryUnlocked = false;
let pinInputsReady  = false;

let localFiles  = [];            // {id, level, semester, title, fileName, mimeType, size, uploadedAt, blob, thumb?}
let cloudFiles  = [];            // metadata from Firestore
let cloudLoaded = false;
let previewUrl  = null;
let thumbUrls   = [];

// ─── small helpers ───
function escHtml(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function libMode() {
  if (Account.status === 'premium') return 'premium';
  if (Account.status === 'expired') return 'expired';
  return 'free';
}
function fileMs(f) {
  if (!f.uploadedAt) return 0;
  if (f.uploadedAt.toMillis) return f.uploadedAt.toMillis();
  return new Date(f.uploadedAt).getTime() || 0;
}
function fmtSize(bytes) {
  if (!bytes) return '';
  return bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (bytes / 1048576).toFixed(1) + ' MB';
}
function newFileId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function sameLevel(a, b) { return String(a) === String(b); }
function levelLabel(l) { return l === 'Books' ? 'Books' : l + ' Level'; }

function detectKind(file) {
  const name = (file.name || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  if (file.type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'image';
  if (['doc', 'docx'].includes(ext) || file.type.includes('msword') || file.type.includes('wordprocessingml')) return 'doc';
  return null;
}
function kindOfMeta(f) {
  const n = (f.fileName || '').toLowerCase();
  const ext = n.includes('.') ? n.split('.').pop() : '';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'doc';
  return 'image';
}

// ─── local storage for free plan (IndexedDB — far bigger than localStorage) ───
function idbOpen() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('This browser blocks local file storage.')); return; }
    const r = indexedDB.open('gradepilot_lib', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbAll() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const q = db.transaction('files').objectStore('files').getAll();
    q.onsuccess = () => resolve(q.result || []);
    q.onerror = () => reject(q.error);
  });
}
async function idbPut(rec) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbDel(id) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Older versions kept files as text inside localStorage. Move them over once. */
async function migrateLegacyLocal() {
  const raw = localStorage.getItem(LIB_LEGACY_KEY);
  if (!raw) return;
  try {
    const old = JSON.parse(raw);
    for (const f of old) {
      if (!f.url) continue;
      const blob = await (await fetch(f.url)).blob();
      await idbPut({
        id: f.id || newFileId(), level: String(f.level), semester: Number(f.semester),
        title: f.title || f.fileName, fileName: f.fileName || 'file',
        mimeType: f.mimeType || blob.type, size: blob.size,
        uploadedAt: f.uploadedAt || new Date().toISOString(), blob,
      });
    }
    localStorage.removeItem(LIB_LEGACY_KEY);
  } catch (e) { console.error('Legacy migration failed', e); }
}

// ─── compression ───
function loadBitmap(file) {
  if (window.createImageBitmap) {
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
function canvasToBlob(canvas, q) {
  return new Promise(res => canvas.toBlob(res, 'image/jpeg', q));
}
/** Shrink a photo to roughly IMAGE_TARGET_KB while keeping it readable. */
async function compressImage(file) {
  const bmp = await loadBitmap(file);
  const w0 = bmp.width, h0 = bmp.height;
  const target = LIBCFG.IMAGE_TARGET_KB * 1024;
  let scale = Math.min(1, 1800 / Math.max(w0, h0));
  let q = 0.82, blob = null;
  for (let i = 0; i < 9; i++) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * scale));
    c.height = Math.max(1, Math.round(h0 * scale));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    blob = await canvasToBlob(c, q);
    if (!blob || blob.size <= target) break;
    if (q > 0.56) q -= 0.1; else scale *= 0.85;
  }
  if (bmp.close) bmp.close();
  return blob;
}
async function makeThumb(blob) {
  const bmp = await loadBitmap(blob);
  const s = Math.min(1, 200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return c.toDataURL('image/jpeg', 0.6);
}
const canGzip = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
async function gzipBlob(blob) {
  return new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}
async function gunzipBlob(blob, type) {
  const out = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).blob();
  return new Blob([out], { type });
}
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Turn what the person picked into a small, ready-to-store file. */
async function prepareFile(file) {
  const kind = detectKind(file);
  if (!kind) throw new Error('File type not supported. Use PDF, Word, PNG, JPG or WEBP.');
  if (kind === 'image') {
    if (file.size > LIBCFG.MAX_IMAGE_MB * 1048576) throw new Error(`Photo too large. Max ${LIBCFG.MAX_IMAGE_MB} MB.`);
    const blob = await compressImage(file);
    if (!blob) throw new Error('Could not read this image. Try another one.');
    const base = (file.name || 'result').replace(/\.[^.]+$/, '');
    return { blob, fileName: base + '.jpg', mimeType: 'image/jpeg', thumb: await makeThumb(blob).catch(() => '') };
  }
  if (file.size > LIBCFG.MAX_FILE_MB * 1048576) {
    throw new Error(`File too large. PDF/Word files must be ${LIBCFG.MAX_FILE_MB} MB or smaller. Tip: take a clear photo of the page instead. Photos are compressed automatically.`);
  }
  return { blob: file, fileName: file.name, mimeType: file.type || (kind === 'pdf' ? 'application/pdf' : 'application/octet-stream'), thumb: '' };
}

/** Upload a prepared file to the user's account. */
async function storeToCloud(meta, blob, onProgress) {
  let payload = blob, gz = false;
  if (canGzip) {
    try {
      const z = await gzipBlob(blob);
      if (z.size < blob.size * 0.97) { payload = z; gz = true; }
    } catch (e) { /* store as is */ }
  }
  const b64 = await blobToBase64(payload);
  const doc = {
    id: meta.id, level: String(meta.level), semester: Number(meta.semester),
    title: meta.title, fileName: meta.fileName, mimeType: meta.mimeType,
    size: blob.size, gz,
  };
  if (meta.thumb) doc.thumb = meta.thumb;
  await Cloud.putFile(doc, b64, onProgress);
}

async function fetchCloudBlob(item) {
  const b64 = await Cloud.getFileB64(item);
  const raw = await (await fetch('data:application/octet-stream;base64,' + b64)).blob();
  return item.gz ? gunzipBlob(raw, item.mimeType) : new Blob([raw], { type: item.mimeType });
}

// ─── PIN gate (unchanged behaviour) ───
function getStoredPin() {
  const stored = localStorage.getItem(PIN_STORAGE_KEY);
  if (!stored || !/^\d{4,6}$/.test(stored)) {
    localStorage.setItem(PIN_STORAGE_KEY, DEFAULT_PIN);
    return DEFAULT_PIN;
  }
  return stored;
}
function isValidLibraryPin(entered) { return entered === DEFAULT_PIN || entered === getStoredPin(); }

function initPinInputs() {
  if (pinInputsReady) return;
  pinInputsReady = true;
  const digits = document.querySelectorAll('.lib-pin-digit');
  digits.forEach((inp, i) => {
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/g, '').slice(-1);
      if (inp.value && i < digits.length - 1) digits[i + 1].focus();
      if (i === digits.length - 1 && inp.value) verifyLibraryPin();
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !inp.value && i > 0) digits[i - 1].focus();
    });
  });
}

function verifyLibraryPin() {
  const digits = document.querySelectorAll('.lib-pin-digit');
  const entered = Array.from(digits).map(d => d.value).join('');
  const errEl = document.getElementById('lib-pin-error');

  if (entered.length < 4) { errEl.textContent = 'Please enter all 4 digits'; return; }

  if (isValidLibraryPin(entered)) {
    libraryUnlocked = true;
    sessionStorage.setItem(SESSION_KEY, '1');
    errEl.textContent = '';
    showLibraryContent();
    loadLibFiles(true);
  } else {
    errEl.textContent = 'Incorrect PIN. Try again.';
    digits.forEach(d => { d.value = ''; d.classList.add('lib-pin-digit--error'); });
    setTimeout(() => {
      digits.forEach(d => d.classList.remove('lib-pin-digit--error'));
      digits[0].focus();
    }, 600);
  }
}

function showLibraryContent() {
  const gate = document.getElementById('lib-pin-gate');
  const content = document.getElementById('lib-content');
  if (gate) gate.style.display = 'none';
  if (content) content.style.display = 'block';
}

function requireLibraryAccess(callback) {
  if (libraryUnlocked || sessionStorage.getItem(SESSION_KEY) === '1') { callback(); return; }
  const entered = window.prompt('Enter library PIN to access this file');
  if (entered === null) return;
  if (isValidLibraryPin(entered)) {
    libraryUnlocked = true;
    sessionStorage.setItem(SESSION_KEY, '1');
    callback();
  } else { alert('Incorrect PIN.'); }
}

function recoverLibraryPin() {
  const answer = window.prompt('Answer the recovery question: What is your best course?');
  if (answer === null) return;
  const savedAnswer = (localStorage.getItem(RECOVERY_ANSWER_KEY) || DEFAULT_RECOVERY_ANSWER).toLowerCase().trim();
  if (answer.toLowerCase().trim() === savedAnswer) {
    localStorage.setItem(PIN_STORAGE_KEY, DEFAULT_PIN);
    document.getElementById('lib-pin-error').textContent = 'PIN reset to 1234.';
    alert('PIN reset to 1234.');
  } else { alert('Incorrect recovery answer.'); }
}

function onLibraryPageOpen() {
  libraryUnlocked = false;
  sessionStorage.removeItem(SESSION_KEY);
  const gate = document.getElementById('lib-pin-gate');
  const content = document.getElementById('lib-content');
  if (gate) gate.style.display = 'flex';
  if (content) content.style.display = 'none';

  const digits = document.querySelectorAll('.lib-pin-digit');
  digits.forEach(d => { d.value = ''; d.classList.remove('lib-pin-digit--error'); });
  const errEl = document.getElementById('lib-pin-error');
  if (errEl) errEl.textContent = '';

  initPinInputs();
  setTimeout(() => { const first = document.querySelector('.lib-pin-digit'); if (first) first.focus(); }, 100);
}

/** Called by account.js when sign-in / plan changes */
function onAccountChanged() {
  const content = document.getElementById('lib-content');
  if (content && content.style.display !== 'none') loadLibFiles(true);
}

// ─── tabs ───
function switchLibLevel(level) {
  currentLibLevel = level;
  document.querySelectorAll('.lib-tab').forEach(t => t.classList.toggle('active', sameLevel(t.dataset.level, level)));
  renderFileGrid();
}
function switchLibSem(sem) {
  currentLibSem = sem;
  document.querySelectorAll('.lib-sem-tab').forEach(t => t.classList.toggle('active', parseInt(t.dataset.sem) === sem));
  renderFileGrid();
}

// ─── loading + drawing ───
async function loadLibFiles(force) {
  const grid = document.getElementById('lib-file-grid');
  if (!grid) return;
  if (force) grid.innerHTML = '<div class="lib-loading">Loading your files…</div>';

  try { await migrateLegacyLocal(); localFiles = await idbAll(); }
  catch (e) { console.error(e); localFiles = []; }

  const mode = libMode();
  if (Account.user && (mode === 'premium' || mode === 'expired')) {
    if (force || !cloudLoaded) {
      try { cloudFiles = await Cloud.listFiles(); cloudLoaded = true; }
      catch (e) { console.error(e); cloudFiles = []; showToast('Could not load your account files.'); }
    }
  } else { cloudFiles = []; cloudLoaded = false; }

  renderLibStatus();
  renderFileGrid();
}

function renderLibStatus() {
  const el = document.getElementById('lib-status');
  if (!el) return;
  const mode = libMode();
  const max = LIBCFG.FREE_LOCAL_MAX_FILES;
  const upgrade = (label) => `<button class="btn-primary lib-status-btn" onclick="openPremiumModal()">${label}</button>`;

  if (mode === 'premium') {
    const move = localFiles.length
      ? `<button class="btn-secondary-outline lib-status-btn" onclick="migrateLocalToCloud(this)">Move ${localFiles.length} file${localFiles.length > 1 ? 's' : ''} from this phone to my account</button>` : '';
    el.className = 'lib-status lib-status--premium';
    el.innerHTML = `<div><strong>Premium</strong> until ${fmtDate(Account.premiumUntil)}<span>${cloudFiles.length} file${cloudFiles.length === 1 ? '' : 's'} saved in your account · up to ${LIBCFG.PREMIUM_MAX_PER_SEMESTER} per semester</span></div>${move}`;
  } else if (mode === 'expired') {
    el.className = 'lib-status lib-status--expired';
    el.innerHTML = `<div><strong>Premium ended</strong> on ${fmtDate(Account.premiumUntil)}<span>Your files are safe. You can open and download them, but new uploads are paused.</span></div>${upgrade('Renew')}`;
  } else {
    const used = Math.min(localFiles.length, max);
    el.className = 'lib-status';
    el.innerHTML = `<div><strong>Free plan</strong> · ${used} of ${max} files kept on this phone<span>Free files live only in this browser. If you clear browser data or change phones, they're gone. Premium saves them to your account.</span></div>${upgrade('Go premium · ' + naira(LIBCFG.PRICE_NAIRA) + '/yr')}`;
  }
}

function renderFileGrid() {
  const grid = document.getElementById('lib-file-grid');
  if (!grid) return;
  thumbUrls.forEach(u => URL.revokeObjectURL(u));
  thumbUrls = [];

  const items = [
    ...cloudFiles.map(f => ({ ...f, src: 'cloud' })),
    ...localFiles.map(f => ({ ...f, src: 'local' })),
  ]
    .filter(f => sameLevel(f.level, currentLibLevel) && Number(f.semester) === currentLibSem)
    .sort((a, b) => fileMs(b) - fileMs(a));

  if (!items.length) {
    grid.innerHTML = `
      <div class="lib-empty">
        <div class="empty-icon">📂</div>
        <div class="empty-title">Nothing here yet</div>
        <div class="empty-sub">Add your ${levelLabel(currentLibLevel)} · Semester ${currentLibSem} result so it's ready when you need it.</div>
      </div>`;
    return;
  }

  grid.innerHTML = items.map(f => {
    const kind = kindOfMeta(f);
    const badge = kind === 'pdf' ? 'pdf' : kind === 'doc' ? 'doc' : 'img';
    const badgeTx = kind === 'pdf' ? 'PDF' : kind === 'doc' ? 'Word' : 'Photo';
    const icon = kind === 'pdf' ? '📄' : kind === 'doc' ? '📝' : '🖼️';
    let thumb = `<span>${icon}</span>`;
    if (kind === 'image') {
      if (f.src === 'cloud' && f.thumb) thumb = `<img src="${escHtml(f.thumb)}" alt="" />`;
      else if (f.src === 'local' && f.blob) { const u = URL.createObjectURL(f.blob); thumbUrls.push(u); thumb = `<img src="${u}" alt="" loading="lazy" />`; }
    }
    const ms = fileMs(f);
    const date = ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const where = f.src === 'cloud' ? '☁ In your account' : '📱 On this phone';
    return `
      <div class="lib-file-card" onclick="openPreview('${f.src}','${f.id}')">
        <span class="lib-file-badge lib-file-badge--${badge}">${badgeTx}</span>
        <div class="lib-file-thumb">${thumb}</div>
        <div class="lib-file-name">${escHtml(f.title || f.fileName)}</div>
        <div class="lib-file-meta">${date}${f.size ? ' · ' + fmtSize(f.size) : ''}</div>
        <div class="lib-file-where lib-file-where--${f.src}">${where}</div>
        <button class="lib-file-del" onclick="deleteLibFile(event,'${f.src}','${f.id}')" title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        </button>
      </div>`;
  }).join('');
}

// ─── upload ───
function updateUploadHint() {
  const el = document.getElementById('lib-upload-dest');
  if (!el) return;
  const mode = libMode();
  const level = document.getElementById('upload-level').value;
  const sem = parseInt(document.getElementById('upload-sem').value);
  if (mode === 'premium') {
    const used = cloudFiles.filter(f => sameLevel(f.level, level) && Number(f.semester) === sem).length;
    el.innerHTML = `Saved to <strong>your account</strong> · ${used} of ${LIBCFG.PREMIUM_MAX_PER_SEMESTER} used for this semester`;
  } else if (mode === 'expired') {
    el.innerHTML = `Uploads are paused until you renew premium.`;
  } else {
    el.innerHTML = `Saved on <strong>this phone only</strong> · ${localFiles.length} of ${LIBCFG.FREE_LOCAL_MAX_FILES} free slots used`;
  }
}

function openUploadModal() {
  const mode = libMode();
  if (mode === 'expired') { openPremiumModal('expired'); return; }
  if (mode === 'free' && localFiles.length >= LIBCFG.FREE_LOCAL_MAX_FILES) { openPremiumModal('limit'); return; }

  document.getElementById('upload-level').value = String(currentLibLevel);
  document.getElementById('upload-sem').value = String(currentLibSem);
  document.getElementById('upload-title').value = '';
  document.getElementById('lib-file-label').textContent = 'Tap to choose a file';
  document.getElementById('lib-upload-error').textContent = '';
  document.getElementById('lib-upload-progress').style.display = 'none';
  document.getElementById('lib-progress-fill').style.width = '0%';
  document.getElementById('btn-do-upload').disabled = false;
  selectedFile = null;
  document.getElementById('upload-file-input').value = '';
  updateUploadHint();
  document.getElementById('lib-upload-modal').style.display = 'flex';
}

function closeUploadModal(e) {
  if (!e || e.target === document.getElementById('lib-upload-modal')) {
    document.getElementById('lib-upload-modal').style.display = 'none';
  }
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  selectedFile = file;
  document.getElementById('lib-file-label').textContent = `✓ ${file.name} (${fmtSize(file.size)})`;
}

function setUploadProgress(frac, text) {
  document.getElementById('lib-upload-progress').style.display = 'block';
  document.getElementById('lib-progress-fill').style.width = Math.round(frac * 100) + '%';
  document.getElementById('lib-progress-text').textContent = text;
}

async function doUpload() {
  const errEl = document.getElementById('lib-upload-error');
  errEl.textContent = '';
  if (!selectedFile) { errEl.textContent = 'Please choose a file first.'; return; }

  const levelRaw = document.getElementById('upload-level').value;
  const level = levelRaw === 'Books' ? 'Books' : parseInt(levelRaw);
  const sem = parseInt(document.getElementById('upload-sem').value);
  const mode = libMode();

  if (mode === 'expired') { closeUploadModal(); openPremiumModal('expired'); return; }
  if (mode === 'free' && localFiles.length >= LIBCFG.FREE_LOCAL_MAX_FILES) {
    closeUploadModal(); openPremiumModal('limit'); return;
  }
  if (mode === 'premium') {
    const used = cloudFiles.filter(f => sameLevel(f.level, level) && Number(f.semester) === sem).length;
    if (used >= LIBCFG.PREMIUM_MAX_PER_SEMESTER) {
      errEl.textContent = `You already have ${LIBCFG.PREMIUM_MAX_PER_SEMESTER} files for ${levelLabel(level)} · Semester ${sem}. Delete one or pick another semester.`;
      return;
    }
  }

  const btn = document.getElementById('btn-do-upload');
  btn.disabled = true;
  try {
    setUploadProgress(0.05, 'Compressing…');
    const prep = await prepareFile(selectedFile);
    const title = document.getElementById('upload-title').value.trim() || selectedFile.name.replace(/\.[^.]+$/, '');
    const meta = { id: newFileId(), level, semester: sem, title, fileName: prep.fileName, mimeType: prep.mimeType, thumb: prep.thumb };

    if (mode === 'premium') {
      setUploadProgress(0.15, 'Saving to your account…');
      await storeToCloud(meta, prep.blob, f => setUploadProgress(0.15 + f * 0.85, `Saving to your account… ${Math.round(f * 100)}%`));
      cloudLoaded = false;
    } else {
      setUploadProgress(0.6, 'Saving on this phone…');
      await idbPut({
        id: meta.id, level: String(level), semester: sem, title, fileName: prep.fileName,
        mimeType: prep.mimeType, size: prep.blob.size, uploadedAt: new Date().toISOString(), blob: prep.blob,
      });
    }

    closeUploadModal();
    currentLibLevel = level; currentLibSem = sem;
    document.querySelectorAll('.lib-tab').forEach(t => t.classList.toggle('active', sameLevel(t.dataset.level, level)));
    document.querySelectorAll('.lib-sem-tab').forEach(t => t.classList.toggle('active', parseInt(t.dataset.sem) === sem));
    await loadLibFiles(mode === 'premium');
    showToast('Result saved');
  } catch (err) {
    console.error(err);
    const denied = err && (err.code === 'permission-denied');
    errEl.textContent = denied
      ? 'Your premium may have ended or not been activated yet. Open Your account → Refresh my status.'
      : (err.message || 'Upload failed. Try again.');
    document.getElementById('lib-upload-progress').style.display = 'none';
    btn.disabled = false;
  }
}

async function migrateLocalToCloud(btn) {
  if (libMode() !== 'premium') return;
  if (btn) { btn.disabled = true; btn.textContent = 'Moving…'; }
  let moved = 0, skipped = 0;
  for (const f of [...localFiles]) {
    const used = cloudFiles.filter(c => sameLevel(c.level, f.level) && Number(c.semester) === Number(f.semester)).length;
    if (used >= LIBCFG.PREMIUM_MAX_PER_SEMESTER) { skipped++; continue; }
    try {
      const thumb = kindOfMeta(f) === 'image' ? await makeThumb(f.blob).catch(() => '') : '';
      await storeToCloud({ id: f.id, level: f.level, semester: f.semester, title: f.title, fileName: f.fileName, mimeType: f.mimeType, thumb }, f.blob);
      await idbDel(f.id);
      cloudFiles.push({ id: f.id, level: f.level, semester: f.semester });
      moved++;
    } catch (e) { console.error(e); skipped++; }
  }
  showToast(`Moved ${moved} file${moved === 1 ? '' : 's'}${skipped ? ` · ${skipped} stayed (semester full or failed)` : ''}`);
  await loadLibFiles(true);
}

async function deleteLibFile(e, src, id) {
  e.stopPropagation();
  if (!confirm('Delete this file? This cannot be undone.')) return;
  try {
    if (src === 'local') { await idbDel(id); }
    else {
      const item = cloudFiles.find(f => f.id === id);
      if (item) await Cloud.deleteFile(item);
    }
    await loadLibFiles(src === 'cloud');
  } catch (err) { alert('Delete failed: ' + err.message); }
}

// ─── preview / download ───
function closePreviewUrl() {
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
}

function openPreview(src, id) {
  requireLibraryAccess(async () => {
    const item = (src === 'cloud' ? cloudFiles : localFiles).find(f => f.id === id);
    if (!item) return;
    const title = item.title || item.fileName;
    const kind = kindOfMeta(item);
    document.getElementById('preview-title').textContent = title;
    const body = document.getElementById('lib-preview-body');
    const dl = document.getElementById('preview-download-btn');
    body.innerHTML = '<div class="lib-loading">Opening…</div>';
    dl.removeAttribute('href');
    document.getElementById('lib-preview-modal').style.display = 'flex';

    try {
      const blob = src === 'cloud' ? await fetchCloudBlob(item) : item.blob;
      closePreviewUrl();
      previewUrl = URL.createObjectURL(blob);
      dl.href = previewUrl;
      dl.setAttribute('download', item.fileName || 'result');
      dl.onclick = null;

      if (kind === 'image') body.innerHTML = `<img src="${previewUrl}" alt="${escHtml(title)}" />`;
      else if (kind === 'pdf') body.innerHTML = `<iframe src="${previewUrl}" title="${escHtml(title)}"></iframe>
        <p class="lib-preview-hint">If the PDF doesn't show on your phone, tap Download.</p>`;
      else body.innerHTML = `
        <div class="lib-doc-placeholder">
          <p>Word documents can't be previewed in the browser.<br>Tap Download to open it.</p>
        </div>`;
    } catch (err) {
      console.error(err);
      body.innerHTML = '<div class="lib-loading">Could not open this file. Check your internet and try again.</div>';
    }
  });
}

function closePreview(e) {
  if (!e || e.target === document.getElementById('lib-preview-modal')) {
    document.getElementById('lib-preview-modal').style.display = 'none';
    document.getElementById('lib-preview-body').innerHTML = '';
    closePreviewUrl();
  }
}

// ─── PIN settings ───
function openLibSettings() {
  ['settings-old-pin', 'settings-new-pin', 'settings-confirm-pin', 'settings-recovery-answer']
    .forEach(id => (document.getElementById(id).value = ''));
  document.getElementById('lib-settings-error').textContent = '';
  document.getElementById('lib-settings-success').textContent = '';
  document.getElementById('lib-settings-modal').style.display = 'flex';
}
function closeLibSettings(e) {
  if (!e || e.target === document.getElementById('lib-settings-modal')) {
    document.getElementById('lib-settings-modal').style.display = 'none';
  }
}
function changeLibraryPin() {
  const oldPin = document.getElementById('settings-old-pin').value;
  const newPin = document.getElementById('settings-new-pin').value;
  const again = document.getElementById('settings-confirm-pin').value;
  const recoveryAnswer = document.getElementById('settings-recovery-answer').value.trim().toLowerCase();
  const errEl = document.getElementById('lib-settings-error');
  const okEl = document.getElementById('lib-settings-success');
  errEl.textContent = ''; okEl.textContent = '';

  if (oldPin !== getStoredPin() && oldPin !== DEFAULT_PIN) { errEl.textContent = 'Current PIN is incorrect.'; return; }
  if (!/^\d{4,6}$/.test(newPin)) { errEl.textContent = 'New PIN must be 4–6 digits.'; return; }
  if (newPin !== again) { errEl.textContent = 'PINs do not match.'; return; }

  localStorage.setItem(PIN_STORAGE_KEY, newPin);
  localStorage.setItem(RECOVERY_ANSWER_KEY, recoveryAnswer || DEFAULT_RECOVERY_ANSWER);
  okEl.textContent = 'PIN updated successfully!';
  setTimeout(() => closeLibSettings(), 1200);
}

document.addEventListener('DOMContentLoaded', () => {
  const drop = document.getElementById('lib-file-drop');
  if (drop) {
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) {
        selectedFile = file;
        document.getElementById('lib-file-label').textContent = `✓ ${file.name} (${fmtSize(file.size)})`;
      }
    });
  }
  ['upload-level', 'upload-sem'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', updateUploadHint);
  });
  onLibraryPageOpen();
});
