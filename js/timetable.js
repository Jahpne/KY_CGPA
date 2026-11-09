// ─── TIMETABLE GENERATOR ───
// Supports two layouts:
//   'days-top'  — time slots run down the side (rows), days run across the top (columns)
//   'time-top'  — days run down the side (rows), time slots run across the top (columns)
// The underlying data model is the same in both cases: a list of time-slot
// rows, each holding a day→content map. The layout only changes how it's rendered.

let ttRows = [];
let _ttUid = 0;
const ttUid = () => 'tt' + (++_ttUid);

const TT_DAYS = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
];

let ttLayout = 'days-top'; // 'days-top' | 'time-top'

function defaultTTRows() {
  return [
    { id: ttUid(), time: '8:00 - 9:00',   cells: { mon:'', tue:'', wed:'', thu:'', fri:'' } },
    { id: ttUid(), time: '9:00 - 10:00',  cells: { mon:'', tue:'', wed:'', thu:'', fri:'' } },
    { id: ttUid(), time: '10:00 - 11:00', cells: { mon:'', tue:'', wed:'', thu:'', fri:'' } },
    { id: ttUid(), time: '11:00 - 12:00', cells: { mon:'', tue:'', wed:'', thu:'', fri:'' } },
  ];
}

function setTTLayout(layout) {
  ttLayout = layout;
  document.querySelectorAll('.tt-layout-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.tt-layout-btn[data-layout="${layout}"]`).classList.add('active');

  // "Add time slot" adds a row in days-top layout, or a column in time-top layout.
  const labelEl = document.getElementById('tt-add-btn-label');
  if (labelEl) labelEl.textContent = layout === 'time-top' ? 'Add time column' : 'Add time slot';

  renderTimetable();
}

function addTTRow() {
  ttRows.push({ id: ttUid(), time: '', cells: { mon:'', tue:'', wed:'', thu:'', fri:'' } });
  renderTimetable();
}

function removeTTRow(rowId) {
  if (ttRows.length <= 1) return;
  ttRows = ttRows.filter(r => r.id !== rowId);
  renderTimetable();
}

function onTTTimeChange(rowId, val) {
  const row = ttRows.find(r => r.id === rowId);
  if (row) row.time = val;
}

function onTTCellChange(rowId, day, val) {
  const row = ttRows.find(r => r.id === rowId);
  if (row) row.cells[day] = val;
}

// ─── RENDER: DAYS ACROSS TOP (time slots as rows) ───
function renderDaysTopLayout(table) {
  const dayHeaders = TT_DAYS.map(d => `<th>${d.label}</th>`).join('');

  const rowsHTML = ttRows.map(row => {
    const dayCells = TT_DAYS.map(d => `
      <td>
        <div class="tt-cell-inner">
          <textarea placeholder="Course / Venue"
            oninput="onTTCellChange('${row.id}','${d.key}',this.value)">${row.cells[d.key]}</textarea>
        </div>
      </td>`).join('');

    return `
      <tr>
        <td class="tt-time-td">
          <div class="tt-time-cell">
            <input type="text" placeholder="e.g. 8:00 - 9:00" value="${row.time}"
                   oninput="onTTTimeChange('${row.id}',this.value)" />
          </div>
        </td>
        ${dayCells}
        <td class="tt-row-del">
          <button onclick="removeTTRow('${row.id}')" title="Remove row">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </td>
      </tr>`;
  }).join('');

  table.innerHTML = `
    <thead>
      <tr>
        <th class="tt-time-col">Time</th>
        ${dayHeaders}
        <th class="tt-action-col"></th>
      </tr>
    </thead>
    <tbody>${rowsHTML}</tbody>`;
}

// ─── RENDER: TIME ACROSS TOP (days as rows) ───
function renderTimeTopLayout(table) {
  const timeHeaders = ttRows.map(row => `
    <th>
      <input type="text" class="tt-time-header-input" placeholder="e.g. 8:00 - 9:00"
             value="${row.time}" oninput="onTTTimeChange('${row.id}',this.value)" />
      <button class="tt-col-del" onclick="removeTTRow('${row.id}')" title="Remove time slot">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </th>`).join('');

  const dayRowsHTML = TT_DAYS.map(d => {
    const cells = ttRows.map(row => `
      <td>
        <div class="tt-cell-inner">
          <textarea placeholder="Course / Venue"
            oninput="onTTCellChange('${row.id}','${d.key}',this.value)">${row.cells[d.key]}</textarea>
        </div>
      </td>`).join('');

    return `
      <tr>
        <td class="tt-day-td">${d.label}</td>
        ${cells}
      </tr>`;
  }).join('');

  table.innerHTML = `
    <thead>
      <tr>
        <th class="tt-day-col">Day</th>
        ${timeHeaders}
      </tr>
    </thead>
    <tbody>${dayRowsHTML}</tbody>`;
}

function renderTimetable() {
  const table = document.getElementById('timetable-table');
  if (!table) return;

  table.classList.toggle('tt-time-top', ttLayout === 'time-top');

  if (ttLayout === 'time-top') {
    renderTimeTopLayout(table);
  } else {
    renderDaysTopLayout(table);
  }
}

/** Export the timetable as a downloadable PDF using html2canvas + jsPDF. */
async function downloadTimetablePDF() {
  const btn = event.currentTarget;
  const originalLabel = btn.innerHTML;
  btn.innerHTML = 'Generating…';
  btn.disabled = true;

  try {
    const title = document.getElementById('tt-title').value || 'My Class Timetable';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed; top:-9999px; left:-9999px; width:1100px; background:#fff; padding:32px; font-family:Inter,Arial,sans-serif;';

    const tableClone = document.getElementById('timetable-table').cloneNode(true);

    // Replace inputs/textareas with plain text for clean PDF rendering
    tableClone.querySelectorAll('input, textarea').forEach(el => {
      const div = document.createElement('div');
      div.textContent = el.value || '';
      div.style.cssText = 'font-size:12px; color:#222; padding:4px; min-height:18px; white-space:pre-wrap;';
      el.replaceWith(div);
    });
    tableClone.querySelectorAll('.tt-row-del, .tt-action-col, .tt-col-del').forEach(el => el.remove());

    tableClone.style.cssText = 'width:100%; border-collapse:collapse;';
    tableClone.querySelectorAll('th, td').forEach(cell => {
      cell.style.border = '1px solid #ddd';
      cell.style.padding = '8px';
      cell.style.verticalAlign = 'top';
    });
    tableClone.querySelectorAll('th').forEach(cell => {
      cell.style.background = '#f3f3f8';
      cell.style.fontSize = '11px';
      cell.style.textTransform = 'uppercase';
      cell.style.letterSpacing = '0.04em';
      cell.style.color = '#555';
    });
    tableClone.querySelectorAll('.tt-day-td, .tt-time-td').forEach(cell => {
      cell.style.fontWeight = '600';
      cell.style.fontSize = '12px';
      cell.style.color = '#333';
      cell.style.background = '#fafafc';
    });

    const heading = document.createElement('h2');
    heading.textContent = title;
    heading.style.cssText = 'font-family:Georgia,serif; font-size:22px; color:#1a1a1a; margin-bottom:18px;';

    wrap.appendChild(heading);
    wrap.appendChild(tableClone);
    document.body.appendChild(wrap);

    const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: '#ffffff' });
    document.body.removeChild(wrap);

    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth - 40;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    const finalHeight = Math.min(imgHeight, pageHeight - 40);
    const finalWidth = (canvas.width * finalHeight) / canvas.height;

    pdf.addImage(imgData, 'PNG', 20, 20, finalWidth, finalHeight);
    pdf.save(title.replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '.pdf');
  } catch (err) {
    console.error('PDF export failed:', err);
    alert('Could not generate PDF. Please try again.');
  } finally {
    btn.innerHTML = originalLabel;
    btn.disabled = false;
  }
}

// Init with default rows
ttRows = defaultTTRows();
