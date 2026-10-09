// Contract time: how each day counts against a project's contract, how many
// days are used, when it ends, and the number a new report gets. Shared by
// the dashboards (project.html, index.html), Project Settings, the report
// editor and Log Quantities (new report numbers), and weather-day-export.js
// (the Weather and Working Day Report), so every place counts days the same
// way. No DOM, no storage: functions/lib/contract-time.js is a copy of this
// file so the weekly roundup's numbers match. Re-copy it whenever this
// file changes.
//
// Per project (both optional, unset means the first option):
//   contractTimeMode   'every' | 'working' | 'calendar'
//   reportNumbering    'next' | 'contractDay' | 'dateOrder' | 'off'
//   reportNumberStart  the first Report No. for 'next' and 'dateOrder'

// unit: what the contract length is in ("120 working days"); counts: what
// uses contract time, for the dashboard's tooltips.
const CONTRACT_TIME_MODES = [
  { value: 'every', label: 'Every day', hint: 'Every day counts, no matter what, Weather Days included.', unit: 'calendar', counts: 'every day, Weather Days included' },
  { value: 'working', label: 'Working days', hint: 'Only weekdays count. Weekends, holidays and Weather Days don\'t use contract time.', unit: 'working', counts: 'weekdays, not counting holidays or Weather Days' },
  { value: 'calendar', label: 'Calendar days', hint: 'Every day counts except Weather Days.', unit: 'calendar', counts: 'every day but Weather Days' },
];
const REPORT_NUMBERING_MODES = [
  { value: 'next', label: 'Next number', hint: 'One more than the highest Report No. on file.' },
  { value: 'contractDay', label: 'Match the contract day', hint: 'The contract day of the report\'s date (day 1 is the NTP date). A report on a day that doesn\'t count (a weekend or Weather Day under Working days) shares the number of the day before it. Needs an NTP date.' },
  { value: 'dateOrder', label: 'Follow date order', hint: 'Its place among the project\'s reports by date, so a report filed late for an earlier day gets the number for that day. Reports already on file keep their numbers.' },
  { value: 'off', label: 'Off', hint: 'Report No. starts blank and the inspector types it.' },
];

function contractTimeMode(project) {
  const v = project && project.contractTimeMode;
  return CONTRACT_TIME_MODES.some((m) => m.value === v) ? v : 'every';
}
function contractTimeModeInfo(mode) {
  return CONTRACT_TIME_MODES.find((m) => m.value === mode) || CONTRACT_TIME_MODES[0];
}
function reportNumberingMode(project) {
  const v = project && project.reportNumbering;
  return REPORT_NUMBERING_MODES.some((m) => m.value === v) ? v : 'next';
}
function reportNumberStart(project) {
  const n = parseInt(project && project.reportNumberStart, 10);
  return n > 0 ? n : 1;
}

function ctIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function ctAddDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return ctIso(d);
}
function ctTodayIso() {
  return ctIso(new Date());
}
const CT_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// The nth (1-based) given weekday of a month, or the last one with n = -1.
function ctNthWeekday(y, m, weekday, n) {
  if (n > 0) {
    const first = new Date(y, m - 1, 1).getDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }
  const days = new Date(y, m, 0).getDate();
  const last = new Date(y, m - 1, days).getDay();
  return days - ((last - weekday + 7) % 7);
}

// Holidays no working-day contract time is charged on, by ISO date. One
// that lands on a weekend is already a weekend, so no observed day is added.
const ctHolidayCache = new Map();
function contractHolidays(y) {
  if (!ctHolidayCache.has(y)) {
    const iso = (m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    ctHolidayCache.set(y, new Map([
      [iso(1, 1), 'New Year\'s Day'],
      [iso(1, ctNthWeekday(y, 1, 1, 3)), 'Martin Luther King Jr. Day'],
      [iso(5, ctNthWeekday(y, 5, 1, -1)), 'Memorial Day'],
      [iso(7, 4), 'Independence Day'],
      [iso(9, ctNthWeekday(y, 9, 1, 1)), 'Labor Day'],
      [iso(11, ctNthWeekday(y, 11, 4, 4)), 'Thanksgiving Day'],
      [iso(12, 25), 'Christmas Day'],
    ]));
  }
  return ctHolidayCache.get(y);
}

// Dates with a Weather Day report (same test as defaults.js's
// isWeatherDayReport, repeated here so the server copy needs nothing else).
function contractWeatherDates(reports) {
  return new Set((reports || [])
    .filter((r) => !r.deleted && CT_ISO_RE.test(r.date || '') && String(r.notes || '').trim().toUpperCase() === 'WEATHER DAY')
    .map((r) => r.date));
}

// How one day counts: { charged, holiday, cause }. charged is false for a
// lost day, with the cause the Weather and Working Day Report prints.
function contractDayInfo(iso, mode, weatherDates) {
  const holiday = contractHolidays(Number(iso.slice(0, 4))).get(iso) || '';
  const dow = new Date(iso + 'T12:00:00').getDay();
  if (mode === 'every') return { charged: true, holiday, cause: '' };
  if (weatherDates && weatherDates.has(iso)) return { charged: false, holiday, cause: 'Weather' };
  if (mode === 'working') {
    if (holiday) return { charged: false, holiday, cause: `${holiday} Holiday` };
    if (dow === 0 || dow === 6) return { charged: false, holiday, cause: 'Weekend' };
  }
  return { charged: true, holiday, cause: '' };
}

// Contract days charged from fromIso through throughIso, both included.
function contractDaysBetween(fromIso, throughIso, mode, weatherDates) {
  let n = 0;
  for (let iso = fromIso; iso <= throughIso; iso = ctAddDays(iso, 1)) {
    if (contractDayInfo(iso, mode, weatherDates).charged) n++;
  }
  return n;
}

// A project's contract time, or null without an NTP date and length.
// day: contract days used through today (the NTP date is day 1; negative
// before NTP, counting down to it). end: the last contract day, counting
// every future work day as charged. usedThrough(iso): days used through
// that date. `today` is for the server, which works in each person's own
// time zone.
function projectContractTimeline(project, reports, today = ctTodayIso()) {
  const meta = (project && project.meta) || {};
  const ntp = meta.ntpDate;
  const length = parseInt(meta.contractLength, 10);
  if (!CT_ISO_RE.test(ntp || '') || !Number.isFinite(length) || length <= 0) return null;
  const mode = contractTimeMode(project);
  const weather = contractWeatherDates(reports);
  const usedThrough = (iso) => (iso < ntp ? 0 : contractDaysBetween(ntp, iso, mode, weather));
  const day = today < ntp
    ? -Math.round((new Date(ntp + 'T12:00:00') - new Date(today + 'T12:00:00')) / 86400000)
    : usedThrough(today);
  let end = ntp;
  for (let n = 0, iso = ntp, guard = 0; guard < 20000; iso = ctAddDays(iso, 1), guard++) {
    if (contractDayInfo(iso, mode, weather).charged && ++n === length) { end = iso; break; }
  }
  return { ntp, length, end, day, frac: Math.max(0, day) / length, mode, usedThrough };
}

// The Report No. a report dated `date` gets under the project's setting,
// given the project's other reports (not including this one). '' when
// numbering is off.
function reportNumberFor(project, otherReports, date) {
  const mode = reportNumberingMode(project);
  const others = otherReports || [];
  const next = () => Math.max(reportNumberStart(project) - 1, ...others.map((r) => Number(r.reportNo) || 0)) + 1;
  if (mode === 'off') return '';
  if (mode === 'contractDay') {
    const tl = projectContractTimeline(project, others);
    if (!tl || !CT_ISO_RE.test(date || '') || date < tl.ntp) return next();
    return Math.max(1, tl.usedThrough(date));
  }
  if (mode === 'dateOrder' && CT_ISO_RE.test(date || '')) {
    return reportNumberStart(project) + others.filter((r) => CT_ISO_RE.test(r.date || '') && r.date <= date).length;
  }
  return next();
}
