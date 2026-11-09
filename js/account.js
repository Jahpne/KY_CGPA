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
function setGate(stateName, message) {
  const gate = document.getElementById('auth-gate');
  if (!gate) return;
  gate.dataset.state = stateName;
  const msg = document.getElementById('auth-gate-msg');
  if (msg) msg.textContent = message || '';
  if (stateName === 'hidden') {
    gate.style.display = 'none';
    document.body.classList.remove('gated');
  } else {
    gate.style.display = 'flex';
    document.body.classList.add('gated');
  }
}

async function startSignIn() {
  if (!window.Cloud) { showToast('Still loading. Try again in a moment.'); return; }
  const btn = document.getElementById('gate-google-btn');
  if (btn) btn.disabled = true;
  try { await Cloud.signIn(); }
  catch (e) {
    console.error(e);
    const m = e && e.code === 'auth/unauthorized-domain'
      ? 'This website address is not yet allowed for sign-in. The owner must add it in Firebase → Authentication → Settings → Authorized domains.'
      : 'Sign-in failed. Check your internet and try again.';
    setGate('signin', m);
  }
  if (btn) btn.disabled = false;
}

// If sign-in services don't load (bad network), say so instead of spinning forever
setTimeout(() => {
  if (!Account.ready && CFG.REQUIRE_LOGIN) {
    setGate('error', 'Could not reach sign-in. Check your internet connection, then tap Retry.');
  }
}, 12000);

// ─── Firebase tells us who is signed in ───
window.onAuthState = function ({ user, profile, error }) {
  Account.ready = true;
  Account.user = user;
  Account.profile = profile;
  Account.status = user ? computeStatus(profile) : 'guest';
  Account.premiumUntil = (profile && profile.premiumUntil)
    ? (profile.premiumUntil.toDate ? profile.premiumUntil.toDate() : new Date(profile.premiumUntil)) : null;

  if (user) {
    setGate('hidden');
    if (error) showToast('Signed in, but your account record could not sync.');
    pullLevels();
  } else if (CFG.REQUIRE_LOGIN) {
    setGate('signin', '');
  } else {
    setGate('hidden');
  }
  renderAuthSlot();
  if (typeof onAccountChanged === 'function') onAccountChanged();
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
    slot.innerHTML = `<button class="auth-signin-btn" onclick="startSignIn()">Sign in</button>`;
    return;
  }
  const u = Account.user;
  const initial = (u.displayName || u.email || '?').trim().charAt(0).toUpperCase();
  const avatar = u.photoURL
    ? `<img src="${escAttr(u.photoURL)}" alt="" referrerpolicy="no-referrer" />`
    : `<span>${escAttr(initial)}</span>`;
  const tag = Account.status === 'premium' ? 'Premium' : Account.status === 'expired' ? 'Expired' : 'Free';
  slot.innerHTML = `
    <button class="auth-chip" onclick="openAccountModal()" title="Your account">
      <span class="auth-avatar">${avatar}</span>
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
      <div class="acct-who">
        <div class="acct-name">${escAttr(u.displayName || 'Student')}</div>
        <div class="acct-email">${escAttr(u.email || '')}</div>
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
  try { await Cloud.refreshProfile(); showToast('Status updated'); }
  catch (e) { showToast('Could not check. Try again.'); }
  openAccountModal();
}

async function doSignOut() {
  closeSheet('account-modal');
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
  setCloudStatus('Syncing…');
  syncTimer = setTimeout(async () => {
    try {
      await Cloud.saveLevels(JSON.stringify(levels), getLocalUpdatedAt() || Date.now());
      setCloudStatus('Backed up to your account');
    } catch (e) {
      console.error('Backup failed', e);
      setCloudStatus('Backup failed. Will retry on next change');
    }
  }, 1500);
}

async function pullLevels() {
  if (!Account.user || !window.Cloud) return;
  try {
    const remote = await Cloud.loadLevels();
    const localAt = getLocalUpdatedAt();
    if (remote && Number(remote.updatedAt) > localAt) {
      const arr = normalizeLevels(JSON.parse(remote.json));
      levels = arr;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(levels));
        localStorage.setItem(UPDATED_KEY, String(remote.updatedAt));
      } catch (e) {}
      renderAll();
      updateGlobal();
      setCloudStatus('Loaded from your account');
      return;
    }
    if (levels.length || localAt > 0) scheduleCloudSave();
    else setCloudStatus('Backup is on');
  } catch (e) {
    console.error('Could not load backup', e);
    setCloudStatus('');
  }
}

// ─── init ───
(function initAccount() {
  if (!CFG.REQUIRE_LOGIN) setGate('hidden');
  else setGate('loading', '');
  renderAuthSlot();
})();
