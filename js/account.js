// ════════════════════════════════════════════════════════
//  ACCOUNT  —  js/account.js
//  Google sign-in gate, header chip, account + premium screens,
//  and backup of courses/grades to the signed-in account.
// ════════════════════════════════════════════════════════
const CFG = window.APP_CONFIG;

const Account = {
  user: null,
  profile: null,
  status: 'guest',        // guest | free | premium | expired
  premiumUntil: null,     // Date or null
  ready: false,
};
window.Account = Account;

// ─── helpers ───
function computeStatus(profile) {
  if (!profile || !profile.premiumUntil) return 'free';
  const d = profile.premiumUntil.toDate ? profile.premiumUntil.toDate() : new Date(profile.premiumUntil);
  return d > new Date() ? 'premium' : 'expired';
}
function fmtDate(d) {
  if (!d) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function naira(n) { return '₦' + Number(n).toLocaleString('en-NG'); }
function isAdminUser() {
  return !!(Account.user && Account.user.email && Account.user.email.toLowerCase() === CFG.ADMIN_EMAIL.toLowerCase());
}

// ─── avatar: Google/custom photo if it loads, otherwise first + last initials ───
function initialsOf(name, email) {
  let n = (name || '').trim();
  if (!n) n = String(email || '').split('@')[0].replace(/[._\-0-9]+/g, ' ').trim();
  const parts = n.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatarHue(seed) {
  let h = 0; const t = String(seed || '');
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360;
  return h;
}
function avatarHTML() {
  const u = Account.user; if (!u) return '';
  return `<span class="avatar" style="background:hsl(${avatarHue(u.email)} 48% 38%)"><span class="avatar-ini">${escAttr(initialsOf(u.displayName, u.email))}</span></span>`;
}

// Google blocks sign-in inside the built-in browsers of WhatsApp, TikTok, Facebook etc.
function isInAppBrowser() {
  return /FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Bytedance|Snapchat|LinkedInApp|Twitter|MicroMessenger|; wv\)/i.test(navigator.userAgent || '');
}
function chromeIntentLink() {
  return `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;end`;
}
function copyPageLink(btn) {
  const done = () => { btn.textContent = 'Link copied. Paste it in Chrome'; };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(done, done);
  else done();
}

let toastTimer = null;
function showToast(msg) {
  let t = document.getElementById('app-toast');
  if (!t) { t = document.createElement('div'); t.id = 'app-toast'; t.className = 'app-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ─── sign-in gate ───
const GUEST_KEY = 'gp_guest';
let signingIn = false, failedTries = 0;

function isGuest() { return sessionStorage.getItem(GUEST_KEY) === '1'; }

const KNOWN_KEY = 'gp_signed_in';
const IDENT_KEY = 'gp_identity';
function knownUser() { return localStorage.getItem(KNOWN_KEY) === '1'; }

function setGate(stateName, message, problem, tone) {
  const gate = document.getElementById('auth-gate');
  if (!gate) return;
  gate.dataset.state = stateName;
  gate.dataset.problem = problem ? '1' : '0';
  gate.dataset.tone = tone || '';
  const msg = document.getElementById('auth-gate-msg');
  if (msg) msg.textContent = message || '';
  const inapp = document.getElementById('auth-inapp');
  if (inapp) {
    inapp.style.display = isInAppBrowser() ? 'block' : 'none';
    const open = document.getElementById('auth-inapp-open');
    if (open) open.href = chromeIntentLink();
  }
  gate.classList.toggle('auth-gate--inapp', isInAppBrowser());
  if (stateName === 'hidden') {
    gate.style.display = 'none';
    document.body.classList.remove('gated');
  } else {
    gate.style.display = 'flex';
    document.body.classList.add('gated');
  }
}

/** Let someone use the calculator even if sign-in is not working. Grades stay on this phone. */
function continueAsGuest() {
  sessionStorage.setItem(GUEST_KEY, '1');
  setGate('hidden');
  renderAuthSlot();
  showToast('Your grades are saved on this phone. Sign in later to back them up.');
}

async function startSignIn() {
  if (signingIn) return;
  if (!window.Cloud) {
    // sign-in code is still arriving (slow network): start as soon as it is here
    window.addEventListener('cloud-ready', startSignIn, { once: true });
    setGate('loading', 'Getting ready. Almost there.', failedTries >= 1);
    return;
  }
  signingIn = true;
  const btn = document.getElementById('gate-google-btn');
  if (btn) btn.disabled = true;
  setGate('signin', 'Opening Google…', failedTries >= 1);
  try {
    await Cloud.signIn();
    setGate('signin', 'Signed in. Opening your account…', false);
  } catch (e) {
    console.warn('Sign-in did not finish:', e && e.code);
    failedTries++;
    // no error words for students: just a calm line and the way forward
    setGate('signin', 'Tap Continue with Google to try again, or continue without signing in.', true);
  }
  signingIn = false;
  if (btn) btn.disabled = false;
}

// Slow connection: keep trying quietly, and offer to continue after 8 seconds.
// (People who signed in before never see this gate; they go straight into the app.)
setTimeout(() => {
  if (!Account.ready && CFG.REQUIRE_LOGIN && !isGuest() && !knownUser()) {
    setGate('loading', 'Getting ready. You can continue now and sign in later.', true);
  }
}, 3500);

// ─── Firebase tells us who is signed in ───
let lastStatusKey = '', pulledFor = null;
window.onAuthState = function ({ user, profile, error, pending }) {
  Account.ready = true;
  Account.user = user;
  Account.profile = profile;
  Account.profileError = error || null;
  Account.pending = !!pending;
  Account.status = user ? computeStatus(profile) : 'guest';
  Account.premiumUntil = (profile && profile.premiumUntil)
    ? (profile.premiumUntil.toDate ? profile.premiumUntil.toDate() : new Date(profile.premiumUntil)) : null;

  if (user) {
    sessionStorage.removeItem(GUEST_KEY);
    localStorage.setItem(KNOWN_KEY, '1');
    try { localStorage.setItem(IDENT_KEY, JSON.stringify({ name: user.displayName || '', email: user.email || '' })); } catch (e) {}
    failedTries = 0;
    setGate('hidden');
    if (error) console.warn('Account sync problem:', error.code);   // admin-only detail, never shown to students
    if (pulledFor !== user.uid) { pulledFor = user.uid; pullLevels(); }
  } else {
    pulledFor = null;
    localStorage.removeItem(KNOWN_KEY);
    if (CFG.REQUIRE_LOGIN && !isGuest()) setGate('signin', '', false);
    else setGate('hidden');
  }
  renderAuthSlot();
  const key = (user ? user.uid : '-') + '|' + Account.status + '|' + (Account.premiumUntil ? Account.premiumUntil.getTime() : 0);
  if (key !== lastStatusKey) {
    lastStatusKey = key;
    if (typeof onAccountChanged === 'function') onAccountChanged();
  }
};

// re-check plan when the person comes back to the tab (e.g. after being activated)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Account.user && window.Cloud) Cloud.refreshProfile().catch(() => {});
});

// ─── header chip ───
function renderAuthSlot() {
  const slot = document.getElementById('auth-slot');
  if (!slot) return;
  if (!Account.user) {
    if (!Account.ready && knownUser()) {
      let id = {}; try { id = JSON.parse(localStorage.getItem(IDENT_KEY) || '{}'); } catch (e) {}
      const ini = escAttr(initialsOf(id.name, id.email));
      slot.innerHTML = `<span class="auth-chip" style="cursor:default"><span class="avatar" style="background:hsl(${avatarHue(id.email)} 48% 38%)"><span class="avatar-ini">${ini}</span></span><span class="auth-chip-name">${escAttr((id.name || '').split(' ')[0])}</span></span>`;
      return;
    }
    slot.innerHTML = `<button class="auth-signin-btn" onclick="startSignIn()">Sign in</button>`;
    return;
  }
  const u = Account.user;
  const tag = Account.status === 'premium' ? 'Premium' : Account.status === 'expired' ? 'Expired' : 'Free';
  slot.innerHTML = `
    <button class="auth-chip" onclick="openAccountModal()" title="Your account">
      ${avatarHTML()}
      <span class="auth-chip-name">${escAttr((u.displayName || u.email || '').split(' ')[0])}</span>
      <span class="plan-tag plan-tag--${Account.status}">${tag}</span>
    </button>`;
}

// ─── account + premium modals ───
function openSheet(id, html) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'lib-modal-overlay';
    el.addEventListener('click', e => { if (e.target === el) closeSheet(id); });
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="lib-modal sheet">${html}</div>`;
  el.style.display = 'flex';
}
function closeSheet(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}
const CLOSE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

function planLine() {
  if (Account.status === 'premium') return `<strong>Premium</strong> · valid until ${fmtDate(Account.premiumUntil)}`;
  if (Account.status === 'expired') return `<strong>Premium expired</strong> on ${fmtDate(Account.premiumUntil)}`;
  return `<strong>Free plan</strong>`;
}

function openAccountModal() {
  if (!Account.user) { startSignIn(); return; }
  const u = Account.user;
  const upgradeLabel = Account.status === 'premium' ? 'Extend premium' : Account.status === 'expired' ? 'Renew premium' : `Go premium — ${naira(CFG.PRICE_NAIRA)}/year`;
  openSheet('account-modal', `
    <div class="lib-modal-header">
      <span class="lib-modal-title">Your account</span>
      <button class="btn-icon" onclick="closeSheet('account-modal')">${CLOSE_ICON}</button>
    </div>
    <div class="lib-modal-body">
      <div class="acct-top">
        <span class="acct-avatar">${avatarHTML()}</span>
        <div class="acct-who">
          <div class="acct-name">${escAttr(u.displayName || 'Student')}</div>
          <div class="acct-email">${escAttr(u.email || '')}</div>
        </div>
      </div>
      <div class="acct-plan">${planLine()}</div>
      <button class="btn-primary acct-btn" onclick="closeSheet('account-modal');openPremiumModal()">${upgradeLabel}</button>
      <button class="btn-secondary-outline acct-btn" onclick="refreshPlan(this)">Refresh my status</button>
      ${isAdminUser() ? `<a class="btn-secondary-outline acct-btn" href="/admin">Open admin panel</a>` : ''}
      <button class="btn-secondary-outline acct-btn acct-btn--out" onclick="doSignOut()">Sign out</button>
    </div>`);
}

async function refreshPlan(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Checking…'; }
  try { await Cloud.refreshProfile(); } catch (e) { /* quiet: updates by itself later */ }
  openAccountModal();
}

async function doSignOut() {
  closeSheet('account-modal');
  localStorage.removeItem(KNOWN_KEY);
  try { await Cloud.signOut(); } catch (e) { console.error(e); }
}

function openPremiumModal(reason) {
  if (!Account.user) {
    if (window.Cloud) startSignIn();
    return;
  }
  const P = CFG.PAY;
  const bank = P.BANK_NAME ? `<div class="pay-row"><span>Bank</span><strong>${escAttr(P.BANK_NAME)}</strong></div>` : '';
  const lead = reason === 'expired'
    ? `Your premium ended on ${fmtDate(Account.premiumUntil)}. Your saved files are still here to open and download. Renew to upload again.`
    : reason === 'limit'
      ? `You've used all ${CFG.FREE_LOCAL_MAX_FILES} free file slots. Premium saves your results to your account, so they're safe on any phone.`
      : `Keep your result files safe in your account and open them from any device.`;
  openSheet('premium-modal', `
    <div class="lib-modal-header">
      <span class="lib-modal-title">Grade Pilot Premium</span>
      <button class="btn-icon" onclick="closeSheet('premium-modal')">${CLOSE_ICON}</button>
    </div>
    <div class="lib-modal-body">
      <p class="prem-lead">${lead}</p>
      <div class="prem-price"><span>${naira(CFG.PRICE_NAIRA)}</span> for 1 year</div>
      <ul class="prem-list">
        <li>Up to <strong>${CFG.PREMIUM_MAX_PER_SEMESTER} result files per semester</strong>, for every level</li>
        <li>Saved in your account, not just this phone</li>
        <li>Photos are compressed for you, PDFs up to ${CFG.MAX_FILE_MB} MB</li>
        <li>After the year, you keep and can open every file. Only new uploads pause until you renew</li>
      </ul>

      <div class="prem-step"><b>1.</b> Transfer ${naira(CFG.PRICE_NAIRA)} to:</div>
      <div class="pay-box">
        ${bank}
        <div class="pay-row"><span>Account name</span><strong>${escAttr(P.ACCOUNT_NAME)}</strong></div>
        <div class="pay-row"><span>Account number</span>
          <strong>${escAttr(P.ACCOUNT_NUMBER)}</strong>
          <button class="pay-copy" onclick="copyAccountNumber(this)">Copy</button></div>
      </div>

      <div class="prem-step"><b>2.</b> Tap the button below. WhatsApp opens with your name and email filled in. Attach your payment screenshot and send.</div>
      <button class="btn-primary acct-btn prem-wa" onclick="sendPaymentProof()">I've paid. Send proof on WhatsApp</button>

      <div class="prem-step"><b>3.</b> We activate your account within ${CFG.SUPPORT_DAYS} working days. Then open <em>Your account</em> and tap <em>Refresh my status</em>.</div>
      <p class="prem-note" id="prem-note">Activating for <strong>${escAttr(Account.user.email)}</strong></p>
    </div>`);
}

function copyAccountNumber(btn) {
  const num = CFG.PAY.ACCOUNT_NUMBER;
  const done = () => { btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = 'Copy'), 1500); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(num).then(done, done);
  else done();
}

async function sendPaymentProof() {
  const u = Account.user;
  const msg =
`Hello, I've paid ${naira(CFG.PRICE_NAIRA)} for Grade Pilot Premium (1 year).
Name: ${u.displayName || ''}
Email: ${u.email}
My payment screenshot is attached.`;
  const url = `https://wa.me/${CFG.WHATSAPP_NUMBER}?text=${encodeURIComponent(msg)}`;
  // open first (inside the tap) so the browser doesn't block it
  const w = window.open(url, '_blank');
  if (!w) window.location.href = url;
  try { await Cloud.claimPayment(); } catch (e) { console.error('claim failed', e); }
  const note = document.getElementById('prem-note');
  if (note) note.innerHTML = `Request sent for <strong>${escAttr(u.email)}</strong>. Don't forget to attach your payment screenshot in WhatsApp.`;
}

// ─── back up courses & grades to the account ───
let syncTimer = null;
function setCloudStatus(text) {
  const el = document.getElementById('cloud-sync-status');
  if (el) el.textContent = text;
}

function scheduleCloudSave() {
  if (!Account.user || !window.Cloud) return;
  clearTimeout(syncTimer);
  if (navigator.onLine === false) {
    setCloudStatus('Saved on this phone. Will back up when you are online');
    window.addEventListener('online', scheduleCloudSave, { once: true });
    return;
  }
  setCloudStatus('Backing up…');
  syncTimer = setTimeout(async () => {
    try {
      const r = await Cloud.saveLevels(JSON.stringify(levels), getLocalUpdatedAt() || Date.now());
      setCloudStatus(r === 'saved' ? 'Backed up to your account' : 'Saved. Backing up when your connection allows');
    } catch (e) {
      console.error('Backup failed', e);
      setCloudStatus('Saved on this phone. Backup will retry');
    }
  }, 1500);
}

const OWNER_KEY = 'sabigrade_levels_owner';
const BACKUP_KEY = 'sabigrade_levels_backup';

/** Keep a safety copy of whatever is on this phone before anything replaces it. */
function backupLocalLevels(label) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw.length > 2) localStorage.setItem(BACKUP_KEY + ':' + label + ':' + Date.now(), raw);
  } catch (e) {}
}

function applyLevels(arr, updatedAt) {
  levels = normalizeLevels(arr);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(levels));
    localStorage.setItem(UPDATED_KEY, String(updatedAt || Date.now()));
  } catch (e) {}
  renderAll();
  updateGlobal();
}

async function pullLevels() {
  if (!Account.user || !window.Cloud) return;
  const uidNow = Account.user.uid;
  try {
    const remote = await Cloud.loadLevels();
    const localAt = getLocalUpdatedAt();
    const owner = localStorage.getItem(OWNER_KEY);
    const hasLocal = levels.length > 0;

    // Grades on this phone belong to a different account → ask, never overwrite silently
    if (owner && owner !== uidNow && hasLocal && remote && remote.json) {
      const useAccount = confirm(
        'This phone has saved grades from a different account.\n\nOK = load the grades from THIS account (the phone copy is kept as a backup).\nCancel = keep the grades on this phone and back them up to this account.');
      backupLocalLevels('before-switch');
      localStorage.setItem(OWNER_KEY, uidNow);
      if (useAccount) { applyLevels(JSON.parse(remote.json), remote.updatedAt); setCloudStatus('Loaded from your account'); }
      else scheduleCloudSave();
      return;
    }
    localStorage.setItem(OWNER_KEY, uidNow);

    if (remote && remote.json && Number(remote.updatedAt) > localAt) {
      if (hasLocal) backupLocalLevels('before-cloud-load');
      applyLevels(JSON.parse(remote.json), remote.updatedAt);
      setCloudStatus('Loaded from your account');
      return;
    }
    // Only push when there is real data (never auto-push an empty list over a backup)
    if (hasLocal) scheduleCloudSave();
    else setCloudStatus('Backup is on');
  } catch (e) {
    console.error('Could not load backup', e);
    setCloudStatus('');
  }
}

// ─── init ───
(function initAccount() {
  if (!CFG.REQUIRE_LOGIN || knownUser()) setGate('hidden');   // returning students never wait on the network
  else setGate('loading', '');
  renderAuthSlot();
})();
