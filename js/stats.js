// ─── STATISTICS: CGPA CANDLESTICK CHART ───

let statsChartInstance = null;
let statsTimeframe = 'level'; // 'level' | 'semester'

/**
 * Build OHLC-style candlestick data per LEVEL.
 * - open  = cumulative CGPA at the START of the level (before its courses)
 * - close = cumulative CGPA at the END of the level (after its courses)
 * - low   = the lower of that level's semester GPAs (or level GPA if only one semester has data)
 * - high  = the higher of that level's semester GPAs
 */
function getCandlesByLevel() {
  const sorted = [...levels].sort((a, b) => a.num - b.num);
  const candles = [];
  let runningUnits = 0, runningQP = 0;
  let idx = 0;

  sorted.forEach(lv => {
    const semGpas = [];
    let lu = 0, lqp = 0;

    ['S1', 'S2'].forEach(s => {
      const st = semStats(lv.sems[s]);
      if (st.units > 0) {
        semGpas.push(st.gpa);
        lu += st.units;
        lqp += st.qp;
      }
    });

    if (lu === 0) return;

    const openCgpa = runningUnits > 0 ? runningQP / runningUnits : (semGpas[0] ?? 0);

    runningUnits += lu;
    runningQP += lqp;
    const closeCgpa = runningQP / runningUnits;

    const low = Math.min(...semGpas, openCgpa, closeCgpa);
    const high = Math.max(...semGpas, openCgpa, closeCgpa);

    candles.push({
      x: idx++,
      label: `${lv.num} Level`,
      o: openCgpa,
      h: high,
      l: low,
      c: closeCgpa,
      levelGpa: lqp / lu,
      units: lu,
    });
  });

  return candles;
}

/**
 * Build OHLC-style candlestick data per SEMESTER.
 * - open  = cumulative CGPA before this semester
 * - close = cumulative CGPA after this semester
 * - low/high = min/max of open, close, and the raw semester GPA
 *   (gives the candle a visible wick even within one semester)
 */
function getCandlesBySemester() {
  const sorted = [...levels].sort((a, b) => a.num - b.num);
  const candles = [];
  let runningUnits = 0, runningQP = 0;
  let idx = 0;

  sorted.forEach(lv => {
    ['S1', 'S2'].forEach(semKey => {
      const st = semStats(lv.sems[semKey]);
      if (st.units === 0) return;

      const openCgpa = runningUnits > 0 ? runningQP / runningUnits : st.gpa;
      runningUnits += st.units;
      runningQP += st.qp;
      const closeCgpa = runningQP / runningUnits;

      const low = Math.min(openCgpa, closeCgpa, st.gpa);
      const high = Math.max(openCgpa, closeCgpa, st.gpa);

      candles.push({
        x: idx++,
        label: `${lv.num}L ${semKey === 'S1' ? '1st' : '2nd'}`,
        o: openCgpa,
        h: high,
        l: low,
        c: closeCgpa,
        levelGpa: st.gpa,
        units: st.units,
      });
    });
  });

  return candles;
}

function getActiveCandles() {
  return statsTimeframe === 'semester' ? getCandlesBySemester() : getCandlesByLevel();
}

function setStatsTimeframe(tf) {
  statsTimeframe = tf;
  document.querySelectorAll('.stats-tf-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.stats-tf-btn[data-tf="${tf}"]`).classList.add('active');
  document.getElementById('stats-tf-label').textContent = tf === 'semester' ? 'By Semester' : 'By Level';
  renderStats();
}

function renderStats() {
  const candles = getActiveCandles();
  const emptyEl = document.getElementById('stats-empty');
  const contentEl = document.getElementById('stats-content');

  if (candles.length === 0) {
    emptyEl.style.display = '';
    contentEl.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  contentEl.style.display = '';

  // ── Summary cards (based on the period's own GPA, not cumulative) ──
  const highest = candles.reduce((a, b) => (b.levelGpa > a.levelGpa ? b : a));
  const lowest  = candles.reduce((a, b) => (b.levelGpa < a.levelGpa ? b : a));

  document.getElementById('stat-highest').textContent = highest.levelGpa.toFixed(2);
  document.getElementById('stat-highest-level').textContent = highest.label;
  document.getElementById('stat-lowest').textContent = lowest.levelGpa.toFixed(2);
  document.getElementById('stat-lowest-level').textContent = lowest.label;
  document.getElementById('stat-levelcount').textContent = candles.length;

  const trendEl = document.getElementById('stat-trend');
  if (candles.length >= 2) {
    const diff = candles[candles.length - 1].c - candles[0].o;
    if (diff > 0.05) {
      trendEl.innerHTML = '↗ Improving';
      trendEl.className = 'stat-value trend-up';
    } else if (diff < -0.05) {
      trendEl.innerHTML = '↘ Declining';
      trendEl.className = 'stat-value trend-down';
    } else {
      trendEl.innerHTML = '→ Stable';
      trendEl.className = 'stat-value trend-flat';
    }
    trendEl.style.fontSize = '1.4rem';
  } else {
    trendEl.textContent = '—';
    trendEl.className = 'stat-value';
    trendEl.style.fontSize = '1.4rem';
  }

  // ── Candlestick chart ──
  const ctx = document.getElementById('cgpaByLevelChart').getContext('2d');

  if (statsChartInstance) statsChartInstance.destroy();

  const labelMap = {};
  candles.forEach(c => { labelMap[c.x] = c.label; });

  statsChartInstance = new Chart(ctx, {
    type: 'candlestick',
    data: {
      datasets: [{
        label: 'CGPA',
        data: candles,
        color: {
          up: '#22C97A',
          down: '#FF5A5A',
          unchanged: '#8A91A8',
        },
        borderColor: {
          up: '#22C97A',
          down: '#FF5A5A',
          unchanged: '#8A91A8',
        },
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
            title: items => labelMap[items[0].parsed.x] || '',
            label: item => {
              const d = item.raw;
              return [
                `Period GPA: ${d.levelGpa.toFixed(2)}`,
                `Cumulative start: ${d.o.toFixed(2)}`,
                `Cumulative end: ${d.c.toFixed(2)}`,
                `Range: ${d.l.toFixed(2)} – ${d.h.toFixed(2)}`,
                `Units: ${d.units}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          ticks: {
            color: '#8A91A8',
            font: { size: 11 },
            callback: val => labelMap[val] ?? '',
            stepSize: 1,
          },
          grid: { display: false },
          offset: true,
        },
        y: {
          beginAtZero: true,
          max: 5,
          ticks: { color: '#5A6175', stepSize: 1 },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
      },
    },
  });
}
