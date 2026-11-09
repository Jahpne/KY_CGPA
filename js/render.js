// ─── HTML TEMPLATES ───

/** Build the inner HTML for all course rows in one semester. */
function courseRowHTML(lvId, semKey, c) {
  const gradeOptions = Object.keys(GP)
    .map(g => `<option value="${g}" ${c.grade === g ? 'selected' : ''}>${g} — ${GP[g]}.0</option>`)
    .join('');

  const unitOptions = [1, 2, 3, 4, 5, 6]
    .map(u => `<option value="${u}" ${c.units == u ? 'selected' : ''}>${u}</option>`)
    .join('');

  return `
    <div class="course-row">
      <input
        type="text"
        placeholder="e.g. MTH 201"
        value="${escAttr(c.name)}"
        oninput="onCourseChange('${lvId}','${semKey}','${c.id}','name',this.value)"
      />
      <select onchange="onCourseChange('${lvId}','${semKey}','${c.id}','units',this.value)">
        ${unitOptions}
      </select>
      <select onchange="onCourseChange('${lvId}','${semKey}','${c.id}','grade',this.value)">
        ${gradeOptions}
      </select>
      <button class="btn-del"
              onclick="removeCourse('${lvId}','${semKey}','${c.id}')"
              title="Remove course">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>`;
}

/** Build the HTML for one semester card (header + courses + add button). */
function semCardHTML(lv, semKey, label) {
  const st      = semStats(lv.sems[semKey]);
  const courses = lv.sems[semKey].map(c => courseRowHTML(lv.id, semKey, c)).join('');

  return `
    <div class="sem-card">
      <div class="sem-card-header">
        <div>
          <div class="sem-name">${label}</div>
          <div class="sem-sub">${lv.num} level</div>
        </div>
        <div class="sem-gpa-chip" id="semchip-${lv.id}${semKey}">
          GPA ${st.gpa.toFixed(2)}
        </div>
      </div>

      <div class="course-table-head">
        <span>Course</span>
        <span>Units</span>
        <span>Grade</span>
        <span></span>
      </div>

      <div id="courses-${lv.id}${semKey}">${courses}</div>

      <button class="btn-add-course" onclick="addCourse('${lv.id}','${semKey}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        Add course
      </button>
    </div>`;
}

/** Re-render only the course list inside a semester (used after add/remove). */
function renderCourses(lvId, semKey) {
  const el = document.getElementById('courses-' + lvId + semKey);
  if (!el) return;
  const lv = levels.find(l => l.id === lvId);
  el.innerHTML = lv.sems[semKey].map(c => courseRowHTML(lvId, semKey, c)).join('');
}

/** Re-render the full levels container. */
function renderAll() {
  const container = document.getElementById('levels-container');

  if (levels.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📚</div>
        <div class="empty-title">No levels yet</div>
        <div class="empty-sub">
          Select a level above and click <strong>Add level</strong> to begin
        </div>
      </div>`;
    return;
  }

  container.innerHTML = levels.map(lv => {
    // Level aggregate
    let lu = 0, lqp = 0;
    ['S1', 'S2'].forEach(s => {
      const st = semStats(lv.sems[s]);
      lu  += st.units;
      lqp += st.qp;
    });
    const lgpa = lu > 0 ? lqp / lu : 0;
    const pill = PILL_CLASS[lv.num] || 'pill-100';

    return `
      <div class="level-block" id="block-${lv.id}">
        <div class="level-header">
          <span class="level-pill ${pill}">${lv.num} level</span>
          <span class="level-gpa-info" id="lvgpa-${lv.id}">
            Level GPA <strong>${lgpa.toFixed(2)}</strong>
            &nbsp;·&nbsp;
            <strong>${lu}</strong> units
          </span>
          <button class="btn-icon"
                  onclick="removeLevel('${lv.id}')"
                  title="Remove level">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
            </svg>
          </button>
        </div>

        <div class="sem-grid">
          ${semCardHTML(lv, 'S1', '1st Semester')}
          ${semCardHTML(lv, 'S2', '2nd Semester')}
        </div>
      </div>`;
  }).join('');
}
