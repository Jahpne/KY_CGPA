// ─── SEMESTER & LEVEL PERFORMANCE COMPARISON ───

let compareChartInstance = null;
let compareView = 'semester'; // 'semester' | 'level'

/** Flatten `levels` into an ordered list of { label, units, qp, gpa } per semester. */
function getSemesterSeries() {
  const series = [];
  levels.forEach(lv => {
    ['S1', 'S2'].forEach(semKey => {
      const st = semStats(lv.sems[semKey]);
      if (st.units > 0) {
        series.push({
          label: `${lv.num}L ${semKey === 'S1' ? '1st' : '2nd'}`,
          units: st.units,
          qp: st.qp,
          gpa: st.gpa,
        });
      }
    });
  });
  return series;
}

/** Flatten `levels` into an ordered list of { label, units, qp, gpa } per level (both semesters combined). */
function getLevelSeries() {
  const sorted = [...levels].sort((a, b) => a.num - b.num);
  const series = [];

  sorted.forEach(lv => {
    let lu = 0, lqp = 0;
    ['S1', 'S2'].forEach(s => {
      const st = semStats(lv.sems[s]);
      lu += st.units;
      lqp += st.qp;
    });
    if (lu > 0) {
      series.push({
        label: `${lv.num} Level`,
        units: lu,
        qp: lqp,
        gpa: lqp / lu,
      });
    }
  });

  return series;
}

function getActiveSeries() {
  return compareView === 'level' ? getLevelSeries() : getSemesterSeries();
}

function setCompareView(view) {
  compareView = view;
  document.querySelectorAll('.compare-view-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.compare-view-btn[data-view="${view}"]`).classList.add('active');
  renderComparison();
}

function deltaHTML(curr, prev) {
  if (prev === null) return `<span class="delta-flat">—</span>`;
  if (prev === 0) return `<span class="delta-flat">—</span>`;

  const pctChange = ((curr - prev) / prev) * 100;

  if (Math.abs(pctChange) < 0.5) return `<span class="delta-flat">No change</span>`;

  if (pctChange > 0) {
    return `<span class="delta-up">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
      ${pctChange.toFixed(0)}% better
    </span>`;
  }
  return `<span class="delta-down">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
    ${Math.abs(pctChange).toFixed(0)}% worse
  </span>`;
}

function renderComparison() {
  const series = getActiveSeries();
  const emptyEl = document.getElementById('compare-empty');
  const contentEl = document.getElementById('compare-content');

  if (series.length === 0) {
    emptyEl.style.display = '';
    contentEl.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  contentEl.style.display = '';

  const rowLabel = compareView === 'level' ? '' : ' Semester';
  const firstColHeader = compareView === 'level' ? 'Level' : 'Semester';
  document.getElementById('compare-col-header').textContent = firstColHeader;

  // ── Narrative summary ──
  const summaryEl = document.getElementById('compare-summary');
  if (series.length >= 2) {
    const sentences = [];
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1];
      const curr = series[i];
      if (prev.gpa === 0) continue;
      const pctChange = ((curr.gpa - prev.gpa) / prev.gpa) * 100;
      if (Math.abs(pctChange) < 0.5) continue;
      const verb = pctChange > 0 ? 'better than' : 'worse than';
      sentences.push(
        `<span class="summary-chip ${pctChange > 0 ? 'summary-chip--up' : 'summary-chip--down'}">
          ${curr.label} was <strong>${Math.abs(pctChange).toFixed(0)}%</strong> ${verb} ${prev.label}
        </span>`
      );
    }
    summaryEl.innerHTML = sentences.length
      ? sentences.join('')
      : '';
    summaryEl.style.display = sentences.length ? 'flex' : 'none';
  } else {
    summaryEl.innerHTML = '';
    summaryEl.style.display = 'none';
  }

  // ── Table ──
  const tbody = document.getElementById('compare-tbody');
  tbody.innerHTML = series.map((s, i) => {
    const prevGpa = i > 0 ? series[i - 1].gpa : null;
    return `<tr>
      <td>${s.label}${rowLabel}</td>
      <td>${s.units}</td>
      <td>${s.qp.toFixed(1)}</td>
      <td><strong>${s.gpa.toFixed(2)}</strong></td>
      <td>${deltaHTML(s.gpa, prevGpa)}</td>
    </tr>`;
  }).join('');

  // ── Chart ──
  const ctx = document.getElementById('compareChart').getContext('2d');
  const labels = series.map(s => s.label);
  const data = series.map(s => s.gpa);
  const chartLabel = compareView === 'level' ? 'Level GPA' : 'Semester GPA';
  const barColor = compareView === 'level' ? 'rgba(34,201,122,0.55)' : 'rgba(108,99,255,0.55)';
  const borderColor = compareView === 'level' ? '#22C97A' : '#6C63FF';

  if (compareChartInstance) compareChartInstance.destroy();

  compareChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: chartLabel,
        data,
        backgroundColor: barColor,
        borderColor: borderColor,
        borderWidth: 1.5,
        borderRadius: 6,
        maxBarThickness: 56,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1E2330',
          titleColor: '#F0F2F7',
          bodyColor: '#8A91A8',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: ctx => `GPA: ${ctx.parsed.y.toFixed(2)}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 5,
          ticks: { color: '#5A6175', stepSize: 1 },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        x: {
          ticks: { color: '#8A91A8', font: { size: 11 } },
          grid: { display: false },
        },
      },
    },
  });
}
