// Builds the monthly "Weather and Working Day Report" workbook from a
// project's reports via ExcelJS: one row per day of the month, whether the
// day was charged as a contract day or lost (weekend, holiday, Weather
// Day), the weather logged that day, and totals for the month, the
// previous report and to date. Laid out like the paper form inspectors
// already turn in, with formulas for the totals so the sheet still adds up
// after someone edits a day by hand. Used by project.html's daily log
// calendar. Needs the global ExcelJS from lib/exceljs.min.js -- callers
// load it first (ensureWeatherDayLibs).

let weatherDayLibsPromise = null;
function ensureWeatherDayLibs() {
  if (!weatherDayLibsPromise) {
    weatherDayLibsPromise = (async () => {
      if (typeof ExcelJS === 'undefined') await lsLoadScript('lib/exceljs.min.js');
    })().catch((err) => { weatherDayLibsPromise = null; throw err; });
  }
  return weatherDayLibsPromise;
}

function wdIso(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// The nth (1-based) given weekday of a month, or the last one with n = -1.
function wdNthWeekday(y, m, weekday, n) {
  if (n > 0) {
    const first = new Date(y, m - 1, 1).getDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }
  const days = new Date(y, m, 0).getDate();
  const last = new Date(y, m - 1, days).getDay();
  return days - ((last - weekday + 7) % 7);
}

// Holidays no contract time is charged on, by ISO date. A holiday that
// lands on a weekend is already a weekend day, so no observed day is added.
// Anything else (a local holiday, a day the contract treats differently)
// can be changed by hand in the downloaded sheet.
function weatherDayHolidays(y) {
  return new Map([
    [wdIso(y, 1, 1), 'New Year\'s Day'],
    [wdIso(y, 1, wdNthWeekday(y, 1, 1, 3)), 'Martin Luther King Jr. Day'],
    [wdIso(y, 5, wdNthWeekday(y, 5, 1, -1)), 'Memorial Day'],
    [wdIso(y, 7, 4), 'Independence Day'],
    [wdIso(y, 9, wdNthWeekday(y, 9, 1, 1)), 'Labor Day'],
    [wdIso(y, 11, wdNthWeekday(y, 11, 4, 4)), 'Thanksgiving Day'],
    [wdIso(y, 12, 25), 'Christmas Day'],
  ]);
}

// The Cause of Losing Day for a Weather Day: the report's Comments on Time
// Charged, cut back to just the reason when it's still the sentence the
// Weather Day button writes ("Weather day (rain). Recommend no time
// charged." -> "Rain").
function weatherDayCause(report) {
  const text = (report.commentsOnTime || '').trim();
  const auto = /^weather day(?: \((.+)\))?\. recommend no time charged\.$/i.exec(text);
  if (!text || auto) {
    const reason = auto && auto[1] ? auto[1].trim() : '';
    return reason ? reason.charAt(0).toUpperCase() + reason.slice(1) : 'Weather';
  }
  return text;
}

// How one day counts. `charged` is true (a contract day), false (a lost
// day) or null (not counted: before NTP or still in the future).
function weatherDayStatus(iso, report, { start, today }) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();
  const holiday = weatherDayHolidays(y).get(iso) || '';
  const out = { sundayHoliday: holiday || (dow === 0 ? 'Sunday' : ''), weather: '', charged: null, cause: '' };
  if (report) {
    const temps = (report.tempHigh || report.tempLow) ? `${report.tempHigh || '--'}°/${report.tempLow || '--'}°F` : '';
    out.weather = [report.weatherDesc, temps].filter(Boolean).join(' ') || (isWeatherDayReport(report) ? 'Weather Day' : '');
  }
  if ((start && iso < start) || iso > today) return out;
  if (holiday) { out.charged = false; out.cause = `${holiday} Holiday`; }
  else if (dow === 0 || dow === 6) { out.charged = false; out.cause = 'Weekend'; }
  else if (report && isWeatherDayReport(report)) { out.charged = false; out.cause = weatherDayCause(report); }
  else out.charged = true;
  return out;
}

// Contract and lost days from `fromIso` up to (not including) `toIso`.
function weatherDayCounts(byDate, fromIso, toIso, opts) {
  let contract = 0, lost = 0;
  if (!fromIso || fromIso >= toIso) return { contract, lost };
  const d = new Date(fromIso + 'T12:00:00');
  for (;;) {
    const iso = wdIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
    if (iso >= toIso) break;
    const s = weatherDayStatus(iso, byDate.get(iso), opts);
    if (s.charged === true) contract++;
    else if (s.charged === false) lost++;
    d.setDate(d.getDate() + 1);
  }
  return { contract, lost };
}

// The contractor for the month: the first contractor named most often on
// that month's reports, else the project's own default.
function weatherDayContractor(monthReports, project) {
  const counts = new Map();
  monthReports.forEach((r) => {
    const name = ((r.contractors || []).find((c) => (c.name || '').trim()) || {}).name;
    if (name) counts.set(name.trim(), (counts.get(name.trim()) || 0) + 1);
  });
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) return top[0];
  return ((project.defaultContractors || []).find((c) => (c.name || '').trim()) || {}).name || '';
}

// monthKey is 'YYYY-MM'. Returns { wb, filename }.
async function buildWeatherDayWorkbook(project, reports, monthKey) {
  await ensureWeatherDayLibs();
  const meta = project.meta || {};
  const [y, m] = monthKey.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthStart = wdIso(y, m, 1);
  const nextMonthStart = wdIso(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1);
  const dated = reports.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date || '')).sort((a, b) => a.date.localeCompare(b.date));
  // A Weather Day wins over another report filed the same day.
  const byDate = new Map();
  dated.forEach((r) => { if (!byDate.has(r.date) || isWeatherDayReport(r)) byDate.set(r.date, r); });
  const ntp = /^\d{4}-\d{2}-\d{2}$/.test(meta.ntpDate || '') ? meta.ntpDate : '';
  const opts = { start: ntp || (dated[0] && dated[0].date) || '', today: todayIso() };
  const monthReports = dated.filter((r) => r.date >= monthStart && r.date < nextMonthStart);
  const estimate = (project.billingEstimates || [])
    .filter((e) => (e.date || '') >= monthStart && (e.date || '') < nextMonthStart)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .pop();
  const previous = weatherDayCounts(byDate, opts.start, monthStart, opts);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Weather and Workday', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true,
      margins: { left: 0.55, right: 0.55, top: 0.49, bottom: 0.49, header: 0.3, footer: 0.3 } },
  });
  ws.columns = [10.4, 11.3, 10.4, 18.6, 11.7, 12.3, 29.9].map((width) => ({ width }));
  const font = { name: 'Arial', size: 10 };
  const thin = { style: 'thin' }, medium = { style: 'medium' };
  const box = (b) => ({ top: b, left: b, bottom: b, right: b });
  const center = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const set = (addr, value, style = {}) => {
    const c = ws.getCell(addr);
    c.value = value;
    c.font = { ...font, ...(style.font || {}) };
    c.alignment = style.alignment || { vertical: 'middle' };
    if (style.border) c.border = style.border;
    if (style.numFmt) c.numFmt = style.numFmt;
    return c;
  };
  const underline = { border: { bottom: thin }, alignment: { horizontal: 'center', vertical: 'middle', shrinkToFit: true } };
  const md = (d) => `${m}/${d}/${String(y).slice(2)}`;

  ws.mergeCells('A1:G1');
  set('A1', 'WEATHER AND WORKING DAY REPORT', { font: { bold: true }, alignment: { horizontal: 'center', vertical: 'middle' } });
  ['B2:C2', 'B3:C3', 'B4:C4'].forEach((r) => ws.mergeCells(r));
  set('A2', 'Est. No.');
  set('B2', estimate ? estimate.estimateNo : '', underline);
  set('F2', 'Est. Period:');
  set('G2', `${md(1)} - ${md(daysInMonth)}`, underline);
  set('A3', 'Date:');
  set('B3', new Date(`${todayIso()}T12:00:00`), { ...underline, numFmt: 'mm-dd-yy' });
  set('F3', 'Project Name:');
  set('G3', meta.projectName || project.name || '', underline);
  set('A4', 'Contractor:');
  set('B4', weatherDayContractor(monthReports, project), underline);
  set('F4', 'Project No.:');
  set('G4', meta.projectNo || '', underline);

  ws.getRow(6).height = 26.25;
  ['Month', 'Day of Month', 'Sundays & Holidays', 'Weather Conditions', 'Contract Days', 'Lost Days', 'Cause of Losing Day']
    .forEach((h, i) => set(`${'ABCDEFG'[i]}6`, h, { font: { bold: true }, alignment: center, border: box(medium) }));

  const first = 7, last = 6 + daysInMonth;
  for (let d = 1; d <= daysInMonth; d++) {
    const row = 6 + d;
    const s = weatherDayStatus(wdIso(y, m, d), byDate.get(wdIso(y, m, d)), opts);
    const cell = (col, v) => set(`${col}${row}`, v, { alignment: center, border: box(thin) });
    cell('A', d === 1 ? new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long' }) : '');
    cell('B', d);
    cell('C', s.sundayHoliday);
    cell('D', s.weather);
    cell('E', s.charged === true ? 1 : null);
    cell('F', s.charged === false ? 1 : null);
    cell('G', s.cause);
  }

  // Totals: this period, previous report, to date, each two rows tall.
  const t = last + 1;
  const totalRow = (r, label, e, f) => {
    ws.mergeCells(`A${r}:D${r + 1}`);
    ws.mergeCells(`E${r}:E${r + 1}`);
    ws.mergeCells(`F${r}:F${r + 1}`);
    set(`A${r}`, label, { font: { bold: true }, alignment: { horizontal: 'right', vertical: 'middle' }, border: box(thin) });
    set(`E${r}`, e, { alignment: center, border: box(thin) });
    set(`F${r}`, f, { alignment: center, border: box(thin) });
    ws.getRow(r).height = 11.25;
    ws.getRow(r + 1).height = 11.25;
  };
  totalRow(t, 'TOTALS FOR THIS PERIOD:', { formula: `SUM(E${first}:E${last})` }, { formula: `SUM(F${first}:F${last})` });
  totalRow(t + 2, 'TOTAL CONTRACT DAYS, PREVIOUS REPORT:', previous.contract, previous.lost);
  totalRow(t + 4, 'GRAND TOTAL CONTRACT DAYS TO DATE:', { formula: `E${t + 2}+E${t}` }, { formula: `F${t + 2}+F${t}` });
  ws.mergeCells(`G${t}:G${t + 5}`);
  const allowed = parseInt(meta.contractLength, 10);
  set(`G${t}`, `Total Allowable Contract Days: ${allowed > 0 ? allowed : '____'}`, { alignment: center, border: box(thin) });

  const sig = t + 6;
  ws.mergeCells(`A${sig}:D${sig + 1}`);
  ws.mergeCells(`E${sig}:G${sig + 1}`);
  const top = { horizontal: 'left', vertical: 'top', wrapText: true };
  set(`A${sig}`, 'I have reviewed the above and concur with the Project Engineer\'s recommendations', { alignment: top });
  set(`E${sig}`, 'I hereby certify that the above information is correct to the best of my knowledge and belief', { alignment: top });
  ws.getRow(sig).height = 20.25;
  ws.mergeCells(`A${sig + 3}:D${sig + 3}`);
  ws.mergeCells(`E${sig + 3}:G${sig + 3}`);
  set(`A${sig + 3}`, 'Sign: ______________________________________');
  set(`E${sig + 3}`, 'Sign: ______________________________________');
  ws.mergeCells(`A${sig + 5}:D${sig + 5}`);
  ws.mergeCells(`E${sig + 5}:G${sig + 5}`);
  set(`A${sig + 5}`, 'Print: ______________________________________');
  set(`E${sig + 5}`, meta.peName ? `Print: ${meta.peName}` : 'Print: ______________________________________');
  set(`A${sig + 6}`, 'Contractor (or Authorized Representative)');
  set(`E${sig + 6}`, 'Project Engineer');
  ws.pageSetup.printArea = `A1:G${sig + 6}`;

  const projectNo = meta.projectNo || 'PR';
  return { wb, filename: `PR${projectNo}_WeatherWorkday_${monthKey}.xlsx` };
}
