// ─── CALCULATION HELPERS ───

/**
 * Compute GPA stats for an array of course objects.
 * @param {Array} courses
 * @returns {{ units: number, qp: number, gpa: number }}
 */
function semStats(courses) {
  let units = 0, qp = 0;
  courses.forEach(c => {
    const cu = parseInt(c.units) || 0;
    units += cu;
    qp    += cu * (GP[c.grade] ?? 0);
  });
  return { units, qp, gpa: units > 0 ? qp / units : 0 };
}

/**
 * Map a CGPA value to its degree classification string.
 * @param {number} cgpa
 * @returns {string}
 */
function classify(cgpa) {
  if (cgpa >= 4.5) return 'First Class';
  if (cgpa >= 3.5) return '2nd Class Upper';
  if (cgpa >= 2.4) return '2nd Class Lower';
  if (cgpa >= 1.5) return 'Third Class';
  if (cgpa >= 1.0) return 'Pass';
  return 'Fail';
}

// ─── DOM UPDATE HELPERS ───

/** Recompute and display the global (cumulative) CGPA. */
function updateGlobal() {
  let totalUnits = 0, totalQP = 0;

  levels.forEach(lv => {
    ['S1', 'S2'].forEach(s => {
      const st = semStats(lv.sems[s]);
      totalUnits += st.units;
      totalQP    += st.qp;
    });
  });

  const cgpa = totalUnits > 0 ? totalQP / totalUnits : null;

  // CGPA value
  document.getElementById('cgpa-val').textContent =
    cgpa !== null ? cgpa.toFixed(2) : '—';

  // Supporting text
  document.getElementById('cgpa-meta').textContent =
    cgpa !== null ? `across ${totalUnits} credit units` : 'Add courses to calculate';

  // Total units & QP
  document.getElementById('units-val').textContent = totalUnits;
  document.getElementById('qp-val').textContent    = totalQP.toFixed(1);

  // Level counter
  document.getElementById('level-count').textContent =
    levels.length + ' added';

  // Degree class badge
  const wrap = document.getElementById('class-badge-wrap');
  if (cgpa !== null) {
    const cls = classify(cgpa);
    const c   = CLASS_COLORS[cls] || {};
    wrap.innerHTML = `
      <div class="class-badge-dynamic"
           style="color:${c.color};background:${c.bg};border:1px solid ${c.border};">
        ${cls}
      </div>`;
  } else {
    wrap.innerHTML = `<div class="stat-value stat-value--muted">—</div>`;
  }
}

/** Refresh the level-GPA info line for one level. */
function updateLevelGPA(lvId) {
  const lv = levels.find(l => l.id === lvId);
  if (!lv) return;

  let lu = 0, lqp = 0;
  ['S1', 'S2'].forEach(s => {
    const st = semStats(lv.sems[s]);
    lu  += st.units;
    lqp += st.qp;
  });

  const lgpa = lu > 0 ? lqp / lu : 0;
  const el   = document.getElementById('lvgpa-' + lvId);
  if (el) {
    el.innerHTML =
      `Level GPA <strong>${lgpa.toFixed(2)}</strong>&nbsp;·&nbsp;<strong>${lu}</strong> units`;
  }
}

/** Refresh the GPA chip inside a semester card. */
function updateSemChip(lvId, semKey) {
  const lv = levels.find(l => l.id === lvId);
  if (!lv) return;

  const st = semStats(lv.sems[semKey]);
  const el = document.getElementById('semchip-' + lvId + semKey);
  if (el) el.textContent = 'GPA ' + st.gpa.toFixed(2);
}

// ─── COURSE MUTATION ───

/** Mutate a course field and refresh all relevant display elements. */
function onCourseChange(lvId, semKey, cid, field, val) {
  const lv = levels.find(l => l.id === lvId);
  if (!lv) return;
  const c  = lv.sems[semKey].find(x => x.id === cid);
  if (!c) return;

  if (field === 'units') c.units = parseInt(val) || 0;
  else if (field === 'grade') c.grade = val;
  else c.name = val;

  updateSemChip(lvId, semKey);
  updateLevelGPA(lvId);
  updateGlobal();
  persistLevels();
}

/** Append a blank course row to a semester. */
function addCourse(lvId, semKey) {
  const lv = levels.find(l => l.id === lvId);
  if (!lv) return;
  lv.sems[semKey].push({ id: uid(), name: '', units: 3, grade: 'A' });
  renderCourses(lvId, semKey);
  updateSemChip(lvId, semKey);
  updateLevelGPA(lvId);
  updateGlobal();
  persistLevels();
  // put the cursor in the new course so you can type straight away
  const rows = document.querySelectorAll('#courses-' + lvId + semKey + ' .course-row input');
  if (rows.length) rows[rows.length - 1].focus();
}

/** Remove a course row (minimum 1 per semester enforced). */
function removeCourse(lvId, semKey, cid) {
  const lv = levels.find(l => l.id === lvId);
  if (!lv || lv.sems[semKey].length <= 1) return;
  lv.sems[semKey] = lv.sems[semKey].filter(c => c.id !== cid);
  renderCourses(lvId, semKey);
  updateSemChip(lvId, semKey);
  updateLevelGPA(lvId);
  updateGlobal();
  persistLevels();
}
