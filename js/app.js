// ─── AUTO-SAVE (this device) + account backup ───
// Auto-save is ON by default. Signed-in users are also backed up to their account
// (see js/account.js → scheduleCloudSave / pullLevels).
const STORAGE_KEY  = 'sabigrade_levels';
const AUTOSAVE_KEY = 'sabigrade_autosave';
const UPDATED_KEY  = 'sabigrade_levels_at';

function isAutoSaveOn()      { return localStorage.getItem(AUTOSAVE_KEY) !== '0'; }
function getLocalUpdatedAt() { return Number(localStorage.getItem(UPDATED_KEY)) || 0; }

/** Called when the user flips the toggle */
function handleAutoSaveToggle(checkbox) {
  const on = checkbox.checked;
  localStorage.setItem(AUTOSAVE_KEY, on ? '1' : '0');
  updateAutoSaveUI(on);
  if (on) persistLevels();          // save immediately on enable
}

/** Update the status badge + Clear button */
function updateAutoSaveUI(on) {
  const status   = document.getElementById('autosave-status');
  const clearBtn = document.getElementById('btn-clear-save');
  if (!status) return;

  if (on) {
    status.classList.add('autosave-status--on');
    if (!status.textContent || status.textContent === 'Off') status.textContent = 'On';
    if (clearBtn) clearBtn.style.display = 'inline-flex';
  } else {
    status.textContent = 'Off';
    status.classList.remove('autosave-status--on');
    if (clearBtn) clearBtn.style.display = 'none';
  }
}

/** Write current levels to this device (and queue the account backup) */
function persistLevels() {
  if (!isAutoSaveOn()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(levels));
    localStorage.setItem(UPDATED_KEY, String(Date.now()));
    const status = document.getElementById('autosave-status');
    if (status) {
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      status.textContent = 'Saved ' + t;
    }
  } catch (e) { /* storage full or blocked */ }
  if (typeof scheduleCloudSave === 'function') scheduleCloudSave();
}

/** Load saved levels on page start */
function loadPersistedLevels() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = normalizeLevels(JSON.parse(raw));   // also repairs old duplicate ids
      if (saved.length) {
        levels = saved;
        return true;
      }
    }
  } catch (e) {}
  return false;
}

/** Clear button — wipes saved data and resets UI */
function clearSavedData() {
  if (!confirm('Clear all your saved levels and courses? This cannot be undone.')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.setItem(UPDATED_KEY, String(Date.now()));
  levels = [];
  renderAll();
  updateGlobal();
  const status = document.getElementById('autosave-status');
  if (status) status.textContent = 'Cleared';
  if (typeof scheduleCloudSave === 'function') scheduleCloudSave();
}

// ─── APP ENTRY POINT ───

/** Add a new level from the dropdown (no duplicates, sorted 100 → 500). */
function addLevel() {
  const sel = document.getElementById('level-select');
  const num = parseInt(sel.value);

  if (levels.find(l => l.num === num)) {
    sel.classList.add('select-styled--error');
    setTimeout(() => sel.classList.remove('select-styled--error'), 1000);
    return;
  }

  const id = 'lv' + num;
  levels.push({
    id,
    num,
    sems: {
      S1: [{ id: uid(), name: '', units: 3, grade: 'A' }],
      S2: [{ id: uid(), name: '', units: 3, grade: 'A' }],
    },
  });
  levels.sort((a, b) => a.num - b.num);

  renderAll();
  updateGlobal();
  persistLevels();

  setTimeout(() => {
    const el = document.getElementById('block-' + id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 50);
}

/** Remove a level with a fade-out animation. */
function removeLevel(lvId) {
  const el = document.getElementById('block-' + lvId);

  if (el) {
    el.style.transition = 'opacity 0.2s, transform 0.2s';
    el.style.opacity    = '0';
    el.style.transform  = 'translateY(-8px)';

    setTimeout(() => {
      levels = levels.filter(l => l.id !== lvId);
      el.remove();
      updateGlobal();
      persistLevels();
      if (levels.length === 0) renderAll();
    }, 200);
  } else {
    levels = levels.filter(l => l.id !== lvId);
    renderAll();
    updateGlobal();
    persistLevels();
  }
}

// ─── INIT ───
(function initAutoSave() {
  const checkbox = document.getElementById('autosave-switch');
  if (checkbox) checkbox.checked = isAutoSaveOn();
  updateAutoSaveUI(isAutoSaveOn());
})();

loadPersistedLevels();
renderAll();
updateGlobal();
renderTimetable();
