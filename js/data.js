// ─── GRADE POINTS ───
const GP = { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };

// ─── LEVEL PILL CSS CLASSES ───
const PILL_CLASS = {
  100: 'pill-100',
  200: 'pill-200',
  300: 'pill-300',
  400: 'pill-400',
  500: 'pill-500',
};

// ─── DEGREE CLASS COLORS ───
const CLASS_COLORS = {
  'First Class':      { color: '#9B93FF', bg: 'rgba(108,99,255,0.12)',  border: 'rgba(108,99,255,0.25)' },
  '2nd Class Upper':  { color: '#22C97A', bg: 'rgba(34,201,122,0.12)', border: 'rgba(34,201,122,0.25)' },
  '2nd Class Lower':  { color: '#4DA6FF', bg: 'rgba(77,166,255,0.12)', border: 'rgba(77,166,255,0.25)' },
  'Third Class':      { color: '#F5A623', bg: 'rgba(245,166,35,0.12)', border: 'rgba(245,166,35,0.25)' },
  'Pass':             { color: '#FF9F43', bg: 'rgba(255,159,67,0.12)', border: 'rgba(255,159,67,0.25)' },
  'Fail':             { color: '#FF5A5A', bg: 'rgba(255,90,90,0.12)',  border: 'rgba(255,90,90,0.25)'  },
};

// ─── STATE ───
let levels = [];
let _uid = 0;

// Unique course id. (Old bug: ids restarted at c1 after every reload, so a new
// course could share an id with a saved one and overwrite it.)
function uid() {
  return 'c' + Date.now().toString(36) + (++_uid).toString(36) + Math.random().toString(36).slice(2, 5);
}

/** Escape text for safe use inside HTML attributes / content. */
function escAttr(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Repair saved data: make sure every level/course has valid, unique ids. */
function normalizeLevels(arr) {
  const seen = new Set();
  const out = [];
  (Array.isArray(arr) ? arr : []).forEach(lv => {
    if (!lv || !lv.num) return;
    const fixed = { id: 'lv' + lv.num, num: Number(lv.num), sems: {} };
    ['S1', 'S2'].forEach(k => {
      const list = (lv.sems && Array.isArray(lv.sems[k]) && lv.sems[k].length) ? lv.sems[k] : [{}];
      fixed.sems[k] = list.map(c => {
        c = c || {};
        let id = c.id;
        if (!id || seen.has(id)) id = uid();
        seen.add(id);
        return {
          id,
          name: String(c.name || ''),
          units: parseInt(c.units) || 3,
          grade: (c.grade in GP) ? c.grade : 'A',
        };
      });
    });
    if (!out.find(x => x.num === fixed.num)) out.push(fixed);
  });
  return out.sort((a, b) => a.num - b.num);
}
