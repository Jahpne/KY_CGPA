// ─── TARGET CGPA PLANNER ───

/** Get current overall standing: total units, total quality points, current CGPA. */
function getCurrentStanding() {
  let totalUnits = 0, totalQP = 0;
  levels.forEach(lv => {
    ['S1', 'S2'].forEach(s => {
      const st = semStats(lv.sems[s]);
      totalUnits += st.units;
      totalQP += st.qp;
    });
  });
  return {
    units: totalUnits,
    qp: totalQP,
    cgpa: totalUnits > 0 ? totalQP / totalUnits : 0,
  };
}

/** Refresh the standing snapshot whenever the Target tab is shown. */
function renderTargetSnapshot() {
  const standing = getCurrentStanding();
  const emptyEl = document.getElementById('target-empty');
  const contentEl = document.getElementById('target-content');

  if (standing.units === 0) {
    emptyEl.style.display = '';
    contentEl.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  contentEl.style.display = '';

  document.getElementById('target-current-cgpa').textContent = standing.cgpa.toFixed(2);
  document.getElementById('target-units-done').textContent = standing.units;
  document.getElementById('target-qp-done').textContent = standing.qp.toFixed(1);

  // Clear any stale result from a previous session
  document.getElementById('target-result').innerHTML = '';
  document.getElementById('target-sim-chips').innerHTML = '';
}

/**
 * Core calculation: given current QP/units, a target CGPA, and how many
 * units remain (semesters × units/semester), find the average GPA needed
 * across all remaining units to reach the target CGPA overall.
 */
function calculateTarget() {
  const standing = getCurrentStanding();
  const targetCgpa = parseFloat(document.getElementById('target-cgpa-input').value);
  const semestersLeft = parseInt(document.getElementById('target-semesters-left').value);
  const unitsPerSem = parseInt(document.getElementById('target-units-per-sem').value) || 18;

  const resultEl = document.getElementById('target-result');

  if (isNaN(targetCgpa) || targetCgpa <= 0 || targetCgpa > 5) {
    resultEl.innerHTML = `<div class="target-alert target-alert--warn">Please enter a valid target CGPA between 0 and 5.0.</div>`;
    return;
  }

  const remainingUnits = semestersLeft * unitsPerSem;
  const finalUnits = standing.units + remainingUnits;

  // QP needed in total to reach target, minus QP already banked
  const totalQPNeeded = targetCgpa * finalUnits;
  const qpStillNeeded = totalQPNeeded - standing.qp;
  const requiredGpa = qpStillNeeded / remainingUnits;

  let html = '';

  if (targetCgpa <= standing.cgpa) {
    // Already there or target is below current — minimal bar
    html = `
      <div class="target-alert target-alert--success">
        <div class="target-alert-title">🎉 You've already reached this target</div>
        <div class="target-alert-body">
          Your current CGPA of <strong>${standing.cgpa.toFixed(2)}</strong> already meets or exceeds
          your target of <strong>${targetCgpa.toFixed(2)}</strong>. Just maintain a GPA of
          <strong>${Math.max(requiredGpa, 0).toFixed(2)}</strong> or higher across your remaining
          ${semestersLeft} semester${semestersLeft > 1 ? 's' : ''} to stay there.
        </div>
      </div>`;
  } else if (requiredGpa > 5) {
    // Mathematically impossible
    html = `
      <div class="target-alert target-alert--danger">
        <div class="target-alert-title">⚠️ Not mathematically possible</div>
        <div class="target-alert-body">
          Reaching a CGPA of <strong>${targetCgpa.toFixed(2)}</strong> would require an average GPA of
          <strong>${requiredGpa.toFixed(2)}</strong> over your remaining ${remainingUnits} units —
          higher than the maximum possible 5.00. Consider a lower target, or increase the number of
          remaining semesters / units to spread the recovery over more credits.
        </div>
      </div>`;
  } else if (requiredGpa < 0) {
    html = `
      <div class="target-alert target-alert--success">
        <div class="target-alert-title">🎉 Target already secured</div>
        <div class="target-alert-body">
          Even a GPA of 0.00 in your remaining semesters wouldn't drop you below
          <strong>${targetCgpa.toFixed(2)}</strong>. You're well ahead of this goal.
        </div>
      </div>`;
  } else {
    const classNeeded = classify(requiredGpa);
    const c = CLASS_COLORS[classNeeded] || {};
    const difficulty = requiredGpa <= 3.0 ? 'comfortable' : requiredGpa <= 4.0 ? 'solid' : requiredGpa <= 4.5 ? 'demanding' : 'very demanding';

    html = `
      <div class="target-alert target-alert--info">
        <div class="target-alert-title">Required average GPA going forward</div>
        <div class="target-required-gpa">${requiredGpa.toFixed(2)}</div>
        <div class="target-alert-body">
          To reach a final CGPA of <strong>${targetCgpa.toFixed(2)}</strong>, you need to average
          <strong>${requiredGpa.toFixed(2)}</strong> GPA across your remaining
          <strong>${semestersLeft} semester${semestersLeft > 1 ? 's' : ''}</strong>
          (≈${remainingUnits} units). That's roughly a
          <span class="target-class-pill" style="color:${c.color};background:${c.bg};border:1px solid ${c.border};">${classNeeded}</span>
          average — a <strong>${difficulty}</strong> target.
        </div>
      </div>`;
  }

  resultEl.innerHTML = html;

  // ── Quick simulator chips ──
  renderTargetSimulator(standing, remainingUnits, finalUnits);
}

/** Show what final CGPA results from common "maintain X average" scenarios. */
function renderTargetSimulator(standing, remainingUnits, finalUnits) {
  const scenarios = [
    { label: 'All A\'s (5.0)', gpa: 5.0 },
    { label: 'Mostly A\'s (4.5)', gpa: 4.5 },
    { label: 'B average (4.0)', gpa: 4.0 },
    { label: 'C average (3.0)', gpa: 3.0 },
  ];

  const chipsEl = document.getElementById('target-sim-chips');
  chipsEl.innerHTML = scenarios.map(s => {
    const projectedQP = standing.qp + (s.gpa * remainingUnits);
    const projectedCgpa = projectedQP / finalUnits;
    const cls = classify(projectedCgpa);
    const c = CLASS_COLORS[cls] || {};
    return `
      <div class="sim-chip">
        <div class="sim-chip-label">${s.label}</div>
        <div class="sim-chip-result">→ ${projectedCgpa.toFixed(2)}</div>
        <div class="sim-chip-class" style="color:${c.color};">${cls}</div>
      </div>`;
  }).join('');
}
