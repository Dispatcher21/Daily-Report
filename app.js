// UI wiring: two views (home list / editor), all backed by the report
// object shape defined in defaults.js and persisted via storage.js.

let currentReport = null;
let activeContractorTab = 0;
let saveTimer = null;
let selectMode = false;
let selectedIds = new Set();

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function scheduleSave() {
  if (!currentReport) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveReport(currentReport).catch(console.error), 400);
}

// ---------- View switching ----------

function showHome() {
  selectMode = false;
  selectedIds.clear();
  $('#btn-select-mode').textContent = 'Select';
  $('#btn-select-mode').hidden = false;
  $('#home-view').hidden = false;
  $('#editor-view').hidden = true;
  $('#btn-back').hidden = true;
  $('#header-title').textContent = 'Daily Reports';
  renderHome();
}

function showEditor(report) {
  currentReport = report;
  activeContractorTab = 0;
  $('#btn-select-mode').hidden = true;
  $('#home-view').hidden = true;
  $('#editor-view').hidden = false;
  $('#btn-back').hidden = false;
  $('#header-title').textContent = `Report #${report.reportNo || ''} - ${report.date || ''}`;
  renderEditor();
}

// ---------- Home view ----------

async function renderHome() {
  const reports = await getAllReports();
  const list = $('#report-list');
  const selectAllRow = $('#select-all-row');
  const downloadBtn = $('#btn-download-selected');
  const newReportBtn = $('#btn-new-report');

  selectAllRow.hidden = !selectMode;
  downloadBtn.hidden = !selectMode;
  newReportBtn.hidden = selectMode;

  if (reports.length === 0) {
    list.innerHTML = '<div class="empty-state">No reports yet. Tap "+ New Report" to start today\'s.</div>';
    downloadBtn.hidden = true;
    selectAllRow.hidden = true;
    return;
  }

  list.innerHTML = reports
    .map(
      (r) => `
      <div class="report-row${selectMode ? ' selectable' : ''}" data-id="${r.id}">
        ${selectMode ? `<input type="checkbox" class="report-row-check" ${selectedIds.has(r.id) ? 'checked' : ''}>` : ''}
        <div class="report-row-main">
          <span class="report-row-date">${r.date || '(no date)'}</span>
          <span class="report-row-sub">${escapeHtml(r.activity || 'No activity noted')}</span>
        </div>
        <div class="report-row-actions">
          ${selectMode ? '' : `<button type="button" class="btn-copy-report" data-copy="${r.id}" title="Copy this report to start a new one">Copy</button>`}
          <span class="report-row-no">#${r.reportNo}</span>
        </div>
      </div>`
    )
    .join('');

  list.querySelectorAll('.report-row').forEach((row) => {
    row.addEventListener('click', () => {
      if (selectMode) {
        const id = row.dataset.id;
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        renderHome();
      } else {
        const report = reports.find((r) => r.id === row.dataset.id);
        showEditor(report);
      }
    });
  });

  if (!selectMode) {
    list.querySelectorAll('.btn-copy-report').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const source = reports.find((r) => r.id === btn.dataset.copy);
        const nextNo = await getNextReportNo();
        const copy = copyReport(source, nextNo);
        await saveReport(copy);
        showEditor(copy);
      });
    });
  }

  if (selectMode) {
    $('#select-count-label').textContent = selectedIds.size > 0 ? `${selectedIds.size} selected` : '';
    $('#btn-select-all').textContent = selectedIds.size === reports.length ? 'Deselect all' : 'Select all';
    downloadBtn.textContent = selectedIds.size > 0 ? `Download Selected (${selectedIds.size})` : 'Download Selected';
    downloadBtn.disabled = selectedIds.size === 0;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

$('#btn-new-report').addEventListener('click', async () => {
  const reports = await getAllReports();
  const nextNo = await getNextReportNo();
  const report = makeBlankReport(nextNo, reports[0]);
  await saveReport(report);
  showEditor(report);
});

$('#btn-back').addEventListener('click', () => {
  currentReport = null;
  showHome();
});

$('#btn-select-mode').addEventListener('click', () => {
  selectMode = !selectMode;
  selectedIds.clear();
  $('#btn-select-mode').textContent = selectMode ? 'Cancel' : 'Select';
  renderHome();
});

$('#btn-select-all').addEventListener('click', async () => {
  const reports = await getAllReports();
  if (selectedIds.size === reports.length) {
    selectedIds.clear();
  } else {
    reports.forEach((r) => selectedIds.add(r.id));
  }
  renderHome();
});

$('#btn-download-selected').addEventListener('click', async () => {
  if (selectedIds.size === 0) return;
  const btn = $('#btn-download-selected');
  const original = btn.textContent;
  btn.textContent = 'Generating...';
  btn.disabled = true;
  try {
    const all = await getAllReports();
    const selected = all.filter((r) => selectedIds.has(r.id));
    if (selected.length === 1) {
      await downloadFilledReport(selected[0]);
    } else {
      await downloadReportsAsZip(selected);
    }
    selectMode = false;
    selectedIds.clear();
    $('#btn-select-mode').textContent = 'Select';
    renderHome();
  } catch (err) {
    console.error(err);
    alert('Could not generate the reports: ' + err.message);
    btn.textContent = original;
    btn.disabled = selectedIds.size === 0;
  }
});

// ---------- Backup / restore ----------

$('#btn-export-backup').addEventListener('click', async () => {
  const btn = $('#btn-export-backup');
  const original = btn.textContent;
  btn.textContent = 'Exporting...';
  btn.disabled = true;
  try {
    const backup = await exportAllReportsBackup();
    const json = JSON.stringify(backup);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    a.href = url;
    a.download = `DailyReportApp_Backup_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    console.error(err);
    alert('Could not export data: ' + err.message);
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
});

$('#btn-import-backup').addEventListener('click', () => {
  $('#import-file-input').click();
});

$('#import-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = ''; // allow re-selecting the same file later
  if (!file) return;
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    if (backup.kind !== 'daily-report-app-backup') {
      alert("That doesn't look like a Daily Report backup file.");
      return;
    }
    const result = await importReportsBackup(backup);
    alert(`Import complete: ${result.added} new, ${result.updated} updated, ${result.skipped} already up to date.`);
    renderHome();
  } catch (err) {
    console.error(err);
    alert('Could not import that file: ' + err.message);
  }
});

// ---------- Editor view ----------

function bindText(id, field) {
  const el = $(id);
  el.value = currentReport[field] ?? '';
  el.addEventListener('input', () => {
    currentReport[field] = el.value;
    scheduleSave();
  });
}

function renderEditor() {
  const r = currentReport;

  bindText('#f-reportNo', 'reportNo');
  bindText('#f-date', 'date');
  bindText('#f-hours', 'hours');
  bindText('#f-activity', 'activity');
  bindText('#f-notes', 'notes');
  bindText('#f-representative', 'representative');
  bindText('#f-peName', 'peName');
  bindText('#f-projectNo', 'projectNo');
  bindText('#f-contractCo', 'contractCo');
  bindText('#f-projectLocation', 'projectLocation');
  bindText('#f-ntpDate', 'ntpDate');
  bindText('#f-projectName', 'projectName');

  bindText('#f-trafficControlNote', 'trafficControlNote');
  bindText('#f-workSummary', 'workSummary');

  bindText('#f-controllingItem', 'controllingItem');
  bindText('#f-commentsOnTime', 'commentsOnTime');
  bindText('#f-controllingItemTimeFrom', 'controllingItemTimeFrom');
  bindText('#f-controllingItemTimeTo', 'controllingItemTimeTo');
  bindText('#f-workingConditions', 'workingConditions');

  bindText('#f-workBegin', 'workBegin');
  bindText('#f-workEnd', 'workEnd');
  bindText('#f-repSignatureName', 'repSignatureName');
  bindText('#f-peSignatureName', 'peSignatureName');

  bindText('#f-weatherDesc', 'weatherDesc');
  bindText('#f-tempHigh', 'tempHigh');
  bindText('#f-tempLow', 'tempLow');

  $$('input[name="f-trafficControlSelect"]').forEach((radio) => {
    radio.checked = radio.value === r.trafficControlSelect;
    radio.addEventListener('change', () => {
      r.trafficControlSelect = radio.value;
      scheduleSave();
    });
  });

  if (!Array.isArray(r.timeEntries) || r.timeEntries.length === 0) {
    r.timeEntries = [{ start: '', end: '' }];
  }
  renderTimeEntries();
  renderContractorTabs();
  renderPayItems();
  renderPhotoGrid();
  setupSignaturePad('#sig-rep', 'repSignatureImage');
  setupSignaturePad('#sig-pe', 'peSignatureImage');

  $('#btn-export').onclick = async () => {
    const btn = $('#btn-export');
    const original = btn.textContent;
    btn.textContent = 'Generating...';
    btn.disabled = true;
    try {
      await downloadFilledReport(currentReport);
    } catch (err) {
      console.error(err);
      alert('Could not generate the report: ' + err.message);
    } finally {
      btn.textContent = original;
      btn.disabled = false;
    }
  };

  $('#btn-delete-report').onclick = async () => {
    if (!confirm('Delete this report? This cannot be undone.')) return;
    await deleteReport(currentReport.id);
    currentReport = null;
    showHome();
  };
}

// ---------- Time worked / hours calculator ----------

// Minutes since midnight for a "HH:MM" <input type="time"> value, or null if unset/invalid.
function timeToMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function entryHours(entry) {
  const start = timeToMinutes(entry.start);
  const end = timeToMinutes(entry.end);
  if (start === null || end === null || end <= start) return null;
  return (end - start) / 60;
}

function totalHours(timeEntries) {
  return timeEntries.reduce((sum, e) => sum + (entryHours(e) || 0), 0);
}

function renderTimeEntries() {
  const container = $('#time-entries');
  container.innerHTML = currentReport.timeEntries
    .map((entry, i) => {
      const h = entryHours(entry);
      const subtotal = entry.start && entry.end ? (h === null ? 'invalid' : `${h.toFixed(2)} hrs`) : '';
      return `
        <div class="time-entry-row" data-idx="${i}">
          <input type="time" class="te-start" data-idx="${i}" data-f="start" value="${entry.start || ''}">
          <span class="te-to">to</span>
          <input type="time" class="te-end" data-idx="${i}" data-f="end" value="${entry.end || ''}">
          <span class="te-subtotal">${subtotal}</span>
          <button type="button" class="te-remove" data-idx="${i}" ${currentReport.timeEntries.length <= 1 ? 'hidden' : ''}>&times;</button>
        </div>`;
    })
    .join('');

  container.querySelectorAll('input[type="time"]').forEach((el) => {
    el.addEventListener('input', () => {
      currentReport.timeEntries[Number(el.dataset.idx)][el.dataset.f] = el.value;
      onTimeEntriesChanged();
    });
  });
  container.querySelectorAll('.te-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentReport.timeEntries.splice(Number(btn.dataset.idx), 1);
      onTimeEntriesChanged();
    });
  });

  updateTotalHoursDisplay();
}

function onTimeEntriesChanged() {
  renderTimeEntries();
  const total = totalHours(currentReport.timeEntries);
  currentReport.hours = total > 0 ? Number(total.toFixed(2)) : currentReport.hours;
  $('#f-hours').value = currentReport.hours;
  scheduleSave();
}

function updateTotalHoursDisplay() {
  const total = totalHours(currentReport.timeEntries);
  $('#total-hours-value').textContent = total.toFixed(2);
}

$('#btn-add-time-entry').addEventListener('click', () => {
  currentReport.timeEntries.push({ start: '', end: '' });
  renderTimeEntries();
  scheduleSave();
});

// ---------- Contractors / equipment matrix ----------

function renderContractorTabs() {
  const tabRow = $('#contractor-tabs');
  tabRow.innerHTML = currentReport.contractors
    .map((c, i) => `<button class="tab-btn${i === activeContractorTab ? ' active' : ''}" data-idx="${i}">${escapeHtml(c.name || 'Contractor ' + (i + 1))}</button>`)
    .join('');
  tabRow.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeContractorTab = Number(btn.dataset.idx);
      renderContractorTabs();
      renderContractorPanel();
    });
  });
  renderContractorPanel();
}

function renderContractorPanel() {
  const panel = $('#contractor-panel');
  const idx = activeContractorTab;
  const contractor = currentReport.contractors[idx];

  panel.innerHTML = `
    <label class="contractor-name-input">Contractor ${idx + 1} Name
      <input type="text" id="contractor-name-input" value="${escapeHtml(contractor.name || '')}" placeholder="e.g. ABC Trucking">
    </label>
    <div id="equip-rows"></div>
  `;

  $('#contractor-name-input').addEventListener('input', (e) => {
    contractor.name = e.target.value;
    scheduleSave();
    tabRow_updateLabel(idx, e.target.value);
  });

  const rowsEl = $('#equip-rows');
  rowsEl.innerHTML = currentReport.equipmentRows
    .map(
      (row, i) => `
      <div class="equip-row">
        <input type="text" data-row="${i}" class="equip-label" value="${escapeHtml(row.label)}" placeholder="(row ${i + 1} label)">
        <input type="number" data-row="${i}" class="equip-qty" value="${row.qty[idx] ?? ''}" min="0">
      </div>`
    )
    .join('');

  rowsEl.querySelectorAll('.equip-label').forEach((el) => {
    el.addEventListener('input', () => {
      currentReport.equipmentRows[Number(el.dataset.row)].label = el.value;
      scheduleSave();
    });
  });
  rowsEl.querySelectorAll('.equip-qty').forEach((el) => {
    el.addEventListener('input', () => {
      currentReport.equipmentRows[Number(el.dataset.row)].qty[idx] = el.value;
      scheduleSave();
    });
  });
}

function tabRow_updateLabel(idx, name) {
  const btn = $(`#contractor-tabs .tab-btn[data-idx="${idx}"]`);
  if (btn) btn.textContent = name || 'Contractor ' + (idx + 1);
}

// ---------- Pay items ----------

function renderPayItems() {
  const container = $('#pay-items');
  container.innerHTML = currentReport.payItems
    .map(
      (item, i) => `
      <div class="pay-item">
        <div class="pay-item-title">Item ${i + 1}</div>
        <div class="field-grid">
          <label>Item Number <input type="text" data-i="${i}" data-f="itemNumber" value="${escapeHtml(item.itemNumber)}"></label>
          <label>Unit <input type="text" data-i="${i}" data-f="unit" value="${escapeHtml(item.unit)}"></label>
        </div>
        <label>Description <input type="text" data-i="${i}" data-f="description" value="${escapeHtml(item.description)}"></label>
        <label>Quantity <input type="number" data-i="${i}" data-f="qty" value="${item.qty}"></label>
      </div>`
    )
    .join('');
  container.querySelectorAll('input').forEach((el) => {
    el.addEventListener('input', () => {
      currentReport.payItems[Number(el.dataset.i)][el.dataset.f] = el.value;
      scheduleSave();
    });
  });
}

// ---------- Photos ----------

function renderPhotoGrid() {
  const grid = $('#photo-grid');
  grid.innerHTML = currentReport.photos
    .map((blob, i) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        return `
          <div class="photo-slot" data-idx="${i}">
            <img src="${url}" alt="Photo ${i + 1}">
            <button type="button" class="photo-remove" data-remove="${i}">&times;</button>
            <span class="photo-num">Photo ${i + 1}</span>
          </div>`;
      }
      return `
        <div class="photo-slot" data-idx="${i}">
          <span>+ Photo ${i + 1}</span>
          <input type="file" accept="image/*" data-add="${i}">
        </div>`;
    })
    .join('');

  grid.querySelectorAll('input[type="file"]').forEach((input) => {
    input.addEventListener('change', () => {
      const idx = Number(input.dataset.add);
      const file = input.files[0];
      if (file) {
        currentReport.photos[idx] = file;
        scheduleSave();
        renderPhotoGrid();
      }
    });
  });
  grid.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.remove);
      currentReport.photos[idx] = null;
      scheduleSave();
      renderPhotoGrid();
    });
  });
}

// ---------- Signature pads ----------

function setupSignaturePad(canvasSel, field) {
  const canvas = $(canvasSel);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1a1a1a';

  const existing = currentReport[field];
  if (existing) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = URL.createObjectURL(existing);
  }

  let drawing = false;

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  const finish = () => {
    if (!drawing) return;
    drawing = false;
    canvas.toBlob((blob) => {
      currentReport[field] = blob;
      scheduleSave();
    }, 'image/png');
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  const idKey = canvasSel === '#sig-rep' ? 'rep' : 'pe';
  $(`[data-clear-sig="${idKey}"]`).onclick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    currentReport[field] = null;
    scheduleSave();
  };
}

// ---------- Init ----------

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('service-worker.js').catch(console.error);
}

showHome();
