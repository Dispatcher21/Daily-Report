// Shapes for reports and projects. All of these are just starting points --
// every field stays editable.

// The template's force/equipment table runs rows 12-33: 22 rows, each with a
// label plus one quantity per contractor column. The first 15 carry the
// template's own default labels; the rest start blank.
const EQUIPMENT_ROW_COUNT = 22; // rows 12..33, fixed by the template

const DEFAULT_EQUIPMENT_LABELS = [
  'Superintendent',
  'Project Manager',
  'Foreman',
  'Operators',
  'Laborers',
  'Police officer',
  '',
  '',
  '',
  'Pickup truck',
  'Manlift',
  'Rough terrain crane',
  'Utility trailer',
  'Patrol unit',
  'Attenuator truck',
  '', '', '', '', '', '', '',
];
const CONTRACTOR_COUNT = 6; // fixed by the template
// How many pay item rows the old printed template had (still how many
// structured rows an imported Excel report is read from, see
// parseDailyWorkReportSheet), and the number of blank rows a brand-new
// report starts with. Not a cap: the printed table is now built to fit
// however many there are (buildSummaryBox in render-report.js).
const PAY_ITEM_ROW_COUNT = 6;
// Photo slots per report: 6 on the Daily Photo Log page, then 4 more on
// the Summary and Photos page that prints only when it's needed (see
// renderReportPages in render-report.js).
const REPORT_PHOTO_COUNT = 10;
function blankPhotoSlots() {
  return Array.from({ length: REPORT_PHOTO_COUNT }, () => null);
}
function fetchedPhotoSlots() {
  return Array.from({ length: REPORT_PHOTO_COUNT }, () => true);
}

function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A "No Work Day" is just a report whose Notes says so -- there's no
// separate flag. Originally this required Notes to be exactly "NO WORK DAY"
// (what the report-editor.html button writes), but that missed a report
// where someone typed their own version ("No work - rain", "No work today,
// site closed") instead of using the button. Matches "no work" anywhere in
// Notes now, case-insensitively, word-bounded so it doesn't fire on "no
// workers showed up" or "no workforce available" -- \b after "work"
// requires the next character to not be a letter/digit/underscore.
const NO_WORK_DAY_NOTE = 'NO WORK DAY'; // still what the button itself writes
const NO_WORK_DAY_RE = /\bno\s+work\b/i;
function isNoWorkDayReport(report) {
  return !!report && NO_WORK_DAY_RE.test(report.notes || '');
}

// Same idea as a No Work Day, but for a day lost specifically to weather
// (the contract-time-extension sense of the term) rather than blank for any
// other reason -- same otherwise-blank-apart-from-Notes convention.
const WEATHER_DAY_NOTE = 'WEATHER DAY';
function isWeatherDayReport(report) {
  return !!report && (report.notes || '').trim().toUpperCase() === WEATHER_DAY_NOTE;
}

// The short "what happened" text used wherever a report needs to be
// scanned at a glance (reports.html's list/card rows, project.html's
// Weather & Schedule list/calendar) -- Activity if it's filled in,
// otherwise the first non-blank line of Work Summary (the big box, more
// likely to actually have something written on a day someone forgot to
// fill in the short Activity line). Returns '' rather than a placeholder
// when neither has anything, so a caller can tell "nothing to show" apart
// from real text and pick its own placeholder wording (or none at all).
// Doesn't special-case No Work Day/Weather Day -- those reports have
// neither field filled in by design, so a caller that wants a distinct
// "NO WORK DAY" badge instead still needs to check
// isNoWorkDayReport/isWeatherDayReport itself first.
function reportActivityText(report) {
  const activity = (report && report.activity || '').trim();
  if (activity) return activity;
  const workSummary = (report && report.workSummary || '');
  return workSummary.split('\n').map((l) => l.trim()).find(Boolean) || '';
}

// True for a catalog item that tracks Start/Stop Station, Side, and/or has a
// Locations list (see the STATIONS/LOCATIONS/SIDE columns in project-file.js).
// These can legitimately show up more than once on the same report --
// different segments/spots/sides worked the same day -- so report-editor.html
// and quick-quantity.html both give them a repeatable "add another entry" UI
// instead of the plain single-quantity-per-item model everything else uses.
// Fixed set, unlike Locations -- which side of the road isn't a per-project
// custom list, so report-editor.html and quick-quantity.html both just
// offer these three rather than reading a list from the project file.
const PAY_ITEM_SIDE_OPTIONS = ['Lt', 'Rt', 'Ctr'];

function payItemNeedsMultiple(catalogItem) {
  return !!catalogItem && (catalogItem.stations || catalogItem.side || catalogItem.computed || catalogItem.theoretical || (catalogItem.locations && catalogItem.locations.length > 0));
}

// Overrun/Underrun for a Theoretical Qty pay item -- Qty minus Theoretical
// Qty, positive meaning more was actually used than the theoretical figure
// called for. Null (shown as a dash) unless both sides are real numbers.
function computeOverrun(qty, theoreticalQty) {
  const q = Number(qty);
  const t = Number(theoreticalQty);
  if (qty === '' || theoreticalQty === '' || !Number.isFinite(q) || !Number.isFinite(t)) return null;
  return Math.round((q - t) * 1000) / 1000;
}

// Shared by report-editor.html and quick-quantity.html so an Overrun figure
// always reads the same wherever it shows up.
function overrunLabel(overrun) {
  if (overrun == null) return '—';
  const sign = overrun > 0 ? '+' : '';
  return `${sign}${overrun} ovr/undr`;
}

// Parses a civil engineering "station" value -- either plain feet (a bare
// number) or standard stationing notation like "120+15" (station 120, plus
// 15 feet; one station is 100 feet, so this is 12,015 feet from the
// reference point). Returns null for anything that's neither, same as a
// plain unparseable number always has.
function parseStation(value) {
  const str = String(value ?? '').trim();
  if (!str) return null;
  const stationMatch = /^(\d+)\s*\+\s*(\d+(?:\.\d+)?)$/.exec(str);
  if (stationMatch) return Number(stationMatch[1]) * 100 + Number(stationMatch[2]);
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : null;
}

// Length x Width area math for a Computed Quantity pay item, converted to
// match the item's own unit -- everything else (Sq Ft, linear units, etc.)
// is left as a plain Length x Width product since there's no unambiguous
// conversion to guess at.
function computeAreaQty(length, width, unit) {
  const l = Number(length);
  const w = Number(width);
  if (!Number.isFinite(l) || !Number.isFinite(w)) return '';
  const sqFt = l * w;
  const u = String(unit || '').trim().toUpperCase();
  const qty = u.includes('SQ YD') || u.includes('SY') ? sqFt / 9 : sqFt;
  return String(Math.round(qty * 1000) / 1000);
}

// ---------- Pay item units and calculators ----------
//
// A catalog item's `unit` is the text printed on the report, exactly as the
// contract has it (LUMP, TONS, SQ. YD.). Its `unitKind` says what that unit
// means: one of PAY_UNITS below, or 'OTHER' for a unit of the admin's own
// (typed quantity, no calculators). Items from before this have no
// unitKind; Project Settings lists them for an admin to confirm, and until
// then the app goes by its own best match of the text (payItemKind).
//
// A report pay item can carry `calc` ({ type, ...inputs }): the helper the
// inspector used to work out the quantity (report-editor.html). The inputs
// are kept so the item can be reopened and adjusted, and so the printed
// report can say how the number was reached on the line under the item.

const PAY_UNITS = [
  { k: 'LF', name: 'Linear feet', aliases: ['LF', 'LIN FT', 'LIN. FT', 'LINEAR FT', 'LINEAR FEET', 'FT', 'FEET', 'L.F.'], calcs: ['stations', 'joints', 'striping'] },
  { k: 'MI', name: 'Miles', aliases: ['MI', 'MILE', 'MILES'], calcs: ['miles'] },
  { k: 'SY', name: 'Square yards', aliases: ['SY', 'SQ YD', 'SQ YDS', 'SQYD', 'SQUARE YARD', 'SQUARE YARDS', 'S.Y.'], calcs: ['area'] },
  { k: 'SF', name: 'Square feet', aliases: ['SF', 'SQ FT', 'SQFT', 'SQUARE FEET', 'SQUARE FOOT', 'S.F.'], calcs: ['area'] },
  { k: 'ACRE', name: 'Acres', aliases: ['ACRE', 'ACRES', 'AC'], calcs: ['acres'] },
  { k: 'CY', name: 'Cubic yards', aliases: ['CY', 'CU YD', 'CU YDS', 'CUYD', 'CUBIC YARD', 'CUBIC YARDS', 'C.Y.'], calcs: ['volume', 'loads', 'thickness'] },
  { k: 'TON', name: 'Tons', aliases: ['TON', 'TONS', 'TN'], calcs: ['tickets', 'paving', 'tonsFromYards'] },
  { k: 'GAL', name: 'Gallons', aliases: ['GAL', 'GALLON', 'GALLONS'], calcs: ['tackRate'] },
  { k: 'HR', name: 'Hours', aliases: ['HR', 'HRS', 'HOUR', 'HOURS', 'MAN HOUR', 'MAN HOURS'], calcs: ['crewHours'] },
  { k: 'DAY', name: 'Days', aliases: ['DAY', 'DAYS', 'WORKING DAY', 'WORKING DAYS', 'CALENDAR DAY', 'CALENDAR DAYS'], calcs: [] },
  { k: 'EA', name: 'Each', aliases: ['EA', 'EACH', 'UNIT', 'UNITS'], calcs: ['count'] },
  { k: 'LS', name: 'Lump sum (logged in dollars)', aliases: ['LS', 'L.S.', 'LUMP', 'LUMP SUM', 'LUMPSUM'], calcs: ['percent'] },
  // Logged as percent complete instead. Stored like any other unit, with a
  // Per Plans Total of 100 and a Unit Price per 1% (the Lump Sum amount
  // / 100), so the dashboards and Pay Apps need nothing special for it.
  { k: 'LSP', name: 'Lump sum (logged in percent)', aliases: ['LSP', 'LS %', 'LS%', 'LUMP SUM %', 'PCT', 'PERCENT', '%'], calcs: [] },
];
const PAY_UNIT_OTHER = 'OTHER';

const PAY_CALCS = {
  stations: 'Length from stations',
  joints: 'Pipe joints',
  striping: 'Striping (lines)',
  miles: 'Miles from stations',
  area: 'Length × Width',
  acres: 'Length × Width (acres)',
  volume: 'Length × Width × Depth',
  loads: 'Truck loads',
  thickness: 'Area × thickness',
  tickets: 'Truck tickets',
  paving: 'Paving (area × thickness)',
  tonsFromYards: 'Tons from yards',
  tackRate: 'Area × rate (tack, prime)',
  crewHours: 'Start/stop × crew size',
  count: 'Count',
  percent: 'Percent complete',
};

function payUnitDef(kind) {
  return PAY_UNITS.find((u) => u.k === kind) || null;
}

// The standard unit a piece of unit text most likely means, or '' when
// nothing matches. Used to suggest a unit for an item that hasn't been
// confirmed yet, and to fill in UNIT TYPE when a project file leaves it out.
function matchPayUnit(unit) {
  const u = String(unit || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!u) return '';
  const bare = u.replace(/\./g, '').trim();
  const hit = PAY_UNITS.find((d) => d.aliases.some((a) => a === u || a.replace(/\./g, '') === bare));
  return hit ? hit.k : '';
}

// What an item's unit means, for calculators and dollar math: the confirmed
// unitKind when there is one ('' for OTHER), otherwise the best match of its
// text. An unconfirmed item is only ever treated as Lump Sum when its text
// is one the dashboards already count as dollars (isLumpSumUnit), so an
// unconfirmed "LUMP" item doesn't start logging dollars before an admin
// says it should.
function payItemKind(catalogItem, unit) {
  const cat = catalogItem || {};
  if (cat.unitKind) return cat.unitKind === PAY_UNIT_OTHER ? '' : cat.unitKind;
  const text = unit || cat.unit;
  const kind = matchPayUnit(text);
  // Same test as isLumpSumUnit in quantity-calc.js (not loaded on every page).
  if (kind === 'LS' && !/^lump\s*sum$|^l\.?s\.?$/i.test(String(text || '').trim())) return '';
  return kind;
}

// An unconfirmed item whose unit text already is a standard unit, spelled
// the standard way (LF, TON, SY...), needs nothing from an admin: it means
// exactly that. Anything else (LUMP, SQ YD, a unit the app doesn't know)
// is listed in Project Settings to confirm.
function payItemUnitNeedsConfirm(catalogItem) {
  if (!catalogItem || catalogItem.unitKind) return false;
  const text = String(catalogItem.unit || '').trim().toUpperCase().replace(/\./g, '');
  return !text || !payUnitDef(text);
}

// Kept for older callers: the unit text's kind, ignoring the catalog.
function payItemUnitKind(unit) {
  return payItemKind(null, unit);
}

// [type, label] pairs an item offers, in order. `catalogItem` may be null
// (an item typed in by hand), in which case only the unit decides. A
// catalog item's `calcs` (if set) narrows the unit's list.
function payItemCalcOptions(catalogItem, unit) {
  const cat = catalogItem || {};
  const kind = payItemKind(catalogItem, unit);
  const def = payUnitDef(kind);
  let types = def ? def.calcs.slice() : [];
  // Before units were confirmed, "Computed" was how an item got Length x
  // Width; an unconfirmed Computed item keeps it whatever its unit.
  if (!cat.unitKind && cat.computed && kind !== 'CY' && !types.includes('area')) types.unshift('area');
  if (kind === 'LS' && !(Number(cat.unitPrice) > 0)) types = types.filter((t) => t !== 'percent');
  if (Array.isArray(cat.calcs)) types = types.filter((t) => cat.calcs.includes(t));
  return types.map((t) => [t, PAY_CALCS[t]]);
}

// Calculators that use the item's start and stop stations.
const PAY_CALCS_USING_STATIONS = ['stations', 'miles', 'striping', 'area', 'volume', 'acres', 'thickness'];

function pcNum(value) {
  const s = String(value ?? '').replace(/[,$]/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function pcFmt(n) {
  return (Math.round(n * 1000) / 1000).toLocaleString('en-US', { maximumFractionDigits: 3 });
}
function pcRound(n, places) {
  const f = Math.pow(10, places);
  return String(Math.round(n * f) / f);
}
// "7", "7:30", "7:30 AM", "15:30" -> hours since midnight, or null.
function pcTime(value) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?\s*$/i.exec(String(value || ''));
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (h > 23 || min > 59) return null;
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return h + min / 60;
}

// Runs an item's calculator. Returns { qty, math, print } once enough is
// filled in, otherwise null. `qty` is the string to store; `math` is the
// working shown in the editor; `print` is the short version for the report.
// `unitPrice` only matters for Percent complete (a Lump Sum's total).
function runPayItemCalc(item, unitPrice) {
  const k = item && item.calc;
  if (!k || !k.type) return null;
  const kind = payItemUnitKind(item.unit);
  const unitText = item.unit || kind;
  const span = () => {
    const a = parseStation(item.startStation);
    const b = parseStation(item.endStation);
    return a != null && b != null ? Math.abs(b - a) : null;
  };
  // A typed length wins; otherwise the station span.
  const lengthOf = (v) => (pcNum(v) == null ? span() : pcNum(v));
  const fromSta = (v) => (pcNum(v) == null ? ' (length from stations)' : '');
  const result = (q, places, math, print) => {
    const qty = pcRound(q, places);
    return { qty, math: `${math} = ${pcFmt(Number(qty))} ${unitText}`.trim(), print };
  };
  switch (k.type) {
    case 'stations': {
      const L = span();
      if (L == null) return null;
      return result(L, 3, `${item.endStation} - ${item.startStation}`, '');
    }
    case 'miles': {
      const L = span();
      if (L == null) return null;
      return result(L / 5280, 3, `${pcFmt(L)} ft ÷ 5,280`, '');
    }
    case 'joints': {
      const n = pcNum(k.joints);
      const len = pcNum(k.len);
      if (n == null || len == null) return null;
      return result(n * len, 3, `${pcFmt(n)} joints × ${pcFmt(len)} ft`, `${pcFmt(n)} joints at ${pcFmt(len)} ft`);
    }
    case 'striping': {
      const L = lengthOf(k.l);
      const lines = pcNum(k.lines);
      if (L == null || lines == null) return null;
      return result(L * lines, 3, `${pcFmt(L)} ft × ${pcFmt(lines)} line${lines === 1 ? '' : 's'}${fromSta(k.l)}`, `${pcFmt(lines)} line${lines === 1 ? '' : 's'}`);
    }
    case 'area':
    case 'volume':
    case 'acres':
    case 'thickness': {
      const L = lengthOf(k.l);
      const W = pcNum(k.w);
      if (L == null || W == null) return null;
      const dims = `${pcFmt(L)} × ${pcFmt(W)} ft`;
      if (k.type === 'acres') return result((L * W) / 43560, 3, `${dims}${fromSta(k.l)} ÷ 43,560`, dims);
      if (k.type === 'volume') {
        const D = pcNum(k.d);
        if (D == null) return null;
        const d3 = `${pcFmt(L)} × ${pcFmt(W)} × ${pcFmt(D)} ft`;
        return result((L * W * D) / 27, 3, `${d3}${fromSta(k.l)} ÷ 27`, d3);
      }
      if (k.type === 'thickness') {
        const T = pcNum(k.t);
        if (T == null) return null;
        return result((L * W * (T / 12)) / 27, 3, `${dims} × ${pcFmt(T)} in${fromSta(k.l)}`, `${dims} at ${pcFmt(T)} in`);
      }
      const sqft = L * W;
      return kind === 'SY' ? result(sqft / 9, 3, `${dims}${fromSta(k.l)} ÷ 9`, dims) : result(sqft, 3, `${dims}${fromSta(k.l)}`, dims);
    }
    case 'loads': {
      const n = pcNum(k.loads);
      const size = pcNum(k.size);
      if (n == null || size == null) return null;
      return result(n * size, 3, `${pcFmt(n)} loads × ${pcFmt(size)} CY`, `${pcFmt(n)} loads at ${pcFmt(size)} CY`);
    }
    case 'tickets': {
      const t = (k.tickets || []).map(pcNum).filter((v) => v != null);
      if (!t.length) return null;
      const n = `${t.length} ticket${t.length === 1 ? '' : 's'}`;
      return result(t.reduce((a, b) => a + b, 0), 3, `${n}: ${t.map(pcFmt).join(' + ')}`, n);
    }
    case 'paving': {
      const A = pcNum(k.area);
      const T = pcNum(k.thick);
      const rate = pcNum(k.rate == null ? '110' : k.rate);
      if (A == null || T == null || rate == null) return null;
      return result((A * T * rate) / 2000, 3, `${pcFmt(A)} SY × ${pcFmt(T)} in × ${pcFmt(rate)} lb/SY-in ÷ 2,000`, `${pcFmt(A)} SY at ${pcFmt(T)} in`);
    }
    case 'tonsFromYards': {
      const cy = pcNum(k.cy);
      const dens = pcNum(k.density);
      if (cy == null || dens == null) return null;
      return result(cy * dens, 3, `${pcFmt(cy)} CY × ${pcFmt(dens)} TON/CY`, `${pcFmt(cy)} CY at ${pcFmt(dens)} TON/CY`);
    }
    case 'tackRate': {
      const A = pcNum(k.area);
      const rate = pcNum(k.rate);
      if (A == null || rate == null) return null;
      return result(A * rate, 3, `${pcFmt(A)} SY × ${pcFmt(rate)} gal/SY`, `${pcFmt(A)} SY at ${pcFmt(rate)} gal/SY`);
    }
    case 'crewHours': {
      const a = pcTime(k.start);
      const b = pcTime(k.stop);
      const crew = pcNum(k.crew);
      if (a == null || b == null || crew == null) return null;
      const off = pcNum(k.off) || 0;
      const hrs = Math.max(0, (b >= a ? b - a : b + 24 - a) - off);
      const offTxt = off ? ` - ${pcFmt(off)} hr off` : '';
      return result(hrs * crew, 2, `${k.start} to ${k.stop}${offTxt} = ${pcFmt(hrs)} hr × ${pcFmt(crew)}`, `${k.start} to ${k.stop}, crew of ${pcFmt(crew)}`);
    }
    case 'count': {
      const n = pcNum(k.n);
      if (n == null) return null;
      return { qty: pcRound(n, 3), math: '', print: '' };
    }
    case 'percent': {
      const p = pcNum(k.pct);
      if (p == null) return null;
      const price = Number(unitPrice);
      if (!(price > 0)) return { qty: null, math: '', print: `${pcFmt(p)}% complete` };
      const qty = pcRound((price * p) / 100, 2);
      const money = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
      return { qty, math: `${pcFmt(p)}% of ${money(price)} = ${money(Number(qty))}`, print: `${pcFmt(p)}% complete` };
    }
    default:
      return null;
  }
}

// The line printed under a pay item: only what was filled in (stations,
// side, location, calculator inputs, theoretical quantity), then remarks.
// '' when there's nothing to add.
function payItemDetailLine(item) {
  if (!item) return '';
  const bits = [];
  const start = String(item.startStation || '').trim();
  const end = String(item.endStation || '').trim();
  if (start || end) bits.push(start && end ? `Sta. ${start} to ${end}` : `Sta. ${start || end}`);
  if (item.side) bits.push(item.side);
  if (item.location) bits.push(item.location);
  const calc = runPayItemCalc(item);
  if (calc && calc.print) {
    bits.push(calc.print);
  } else if (!item.calc && (pcNum(item.length) != null || pcNum(item.width) != null)) {
    // Reports from before the calculators kept Length/Width on their own.
    bits.push([item.length, item.width].filter((v) => String(v ?? '').trim()).join(' × ') + ' ft');
  }
  const theo = pcNum(item.theoreticalQty);
  if (theo != null) {
    const q = pcNum(item.qty);
    const diff = q != null ? Math.round((q - theo) * 1000) / 1000 : null;
    bits.push(`Theoretical ${pcFmt(theo)}${item.unit ? ' ' + item.unit : ''}${diff != null && diff !== 0 ? `, ${diff > 0 ? 'over' : 'under'} by ${pcFmt(Math.abs(diff))}` : ''}`);
  }
  let line = bits.join(', ');
  const remarks = String(item.remarks || '').trim();
  if (remarks) line += `${line ? '. ' : ''}${remarks}`;
  return line;
}

// `project` supplies the project-level starting values (from its uploaded
// data file -- Project No./Contract Co./etc, plus optional "default" values
// for most other fields) and `previous` is the most recent report already
// in that SAME project, used to carry forward day-to-day fields like
// representative/hours/contractors/equipment labels the way it always has.
//
// Precedence: fields that already had carry-forward behavior (representative,
// PE name, hours, contractors, equipment labels) keep preferring the
// previous report over the project default, so existing behavior doesn't
// change. Fields newly seedable from the project file (activity, notes,
// working conditions, etc.) just use the project default every time, since
// they never carried forward from a previous report before -- there's
// nothing to regress.
async function makeBlankReport(nextReportNo, project, previous) {
  const meta = (project && project.meta) || {};
  const projectContractors = (project && project.defaultContractors) || [];
  const projectEquipmentLabels = (project && project.defaultEquipmentLabels) || [];
  // A device logged in with a name (see login.html) always wins over
  // carry-forward/project-default -- that old behavior was a convenience
  // for "same person, next day"; a real identity is a better answer to the
  // same question, and covers a different person picking up the project too.
  const loggedInName = typeof getUserName === 'function' ? await getUserName() : null;
  // Prefer the project's own tag (it's the authority on which company a
  // report under it belongs to) over the currently-joined room, though in
  // the normal case of creating a report for an already-in-scope project
  // these are the same thing -- see projectInScope/reportInScope.
  const room = typeof getCompanyRoom === 'function' ? await getCompanyRoom() : null;
  const companyCode = (project && project.companyCode) || (room && room.code) || null;

  // Multiple inspectors, each with their own logged time -- see
  // report-editor.html's Time Worked section. Same "who's on it" carry-
  // forward as contractors/equipment labels below: a device logged in with
  // a name still wins for the single-inspector case (today's exact
  // behavior), but a previous report that already had more than one
  // inspector carries the whole list of names forward -- likely the same
  // crew, new day -- with each one's time starting blank again.
  const inspectorNames = previous && Array.isArray(previous.inspectors) && previous.inspectors.length > 1
    ? previous.inspectors.map((insp) => insp.name || '')
    : [loggedInName || (previous ? previous.representative : meta.representative || '')];
  // `representative` stays a plain joined-names string, kept in sync from
  // the inspector list, for everything else that only understands one name
  // (dashboard, search, Quantity Sheet, mass edit, the printed header cell).
  const representativeName = inspectorNames.filter((n) => n.trim()).join(', ');
  const report = {
    id: crypto.randomUUID(),
    projectId: project ? project.id : null,
    companyCode,
    reportNo: nextReportNo,
    date: todayIso(),
    hours: previous ? previous.hours : '',
    timeEntries: [{ start: '', end: '' }],
    // Hours carries forward the same way the report-level field above does,
    // but only when there's exactly one inspector to unambiguously give it
    // to -- splitting a carried-forward total across more than one
    // carried-forward name would just be a guess, so those start blank.
    inspectors: inspectorNames.map((name) => ({
      name,
      hours: inspectorNames.length === 1 ? (previous ? previous.hours : '') : '',
      timeEntries: [{ start: '', end: '' }],
    })),
    activity: meta.activity || '',
    notes: meta.notes || '',
    peName: previous ? previous.peName : meta.peName || '',
    projectNo: meta.projectNo || '',
    projectName: meta.projectName || '',
    representative: representativeName,
    ntpDate: meta.ntpDate || '',
    contractors: previous
      ? previous.contractors.map((c) => ({ name: c.name }))
      : Array.from({ length: CONTRACTOR_COUNT }, (_, i) => ({ name: projectContractors[i] || '' })),
    // Always exactly EQUIPMENT_ROW_COUNT rows -- fixed by the template's
    // physical row layout. If the project supplies fewer custom labels than
    // that, the remaining rows are just left blank (not backfilled from the
    // generic default list, which would silently mix unrelated labels in).
    // Carrying forward from an older report pads it out too, since reports
    // saved before the table grew to 22 rows only hold 15.
    equipmentRows: Array.from({ length: EQUIPMENT_ROW_COUNT }, (_, i) => ({
      label: previous
        ? (previous.equipmentRows[i] || {}).label || ''
        : projectEquipmentLabels.length
          ? projectEquipmentLabels[i] || ''
          : DEFAULT_EQUIPMENT_LABELS[i],
      qty: ['', '', '', '', '', ''],
    })),
    // Three distinct blocks on the printed form, top to bottom: the line
    // beside "WORK SUMMARY:", the line under it, then the large box.
    workSummaryHeader: meta.workSummaryHeader || '',
    trafficControlNote: meta.trafficControlNote || '',
    workSummary: meta.workSummary || '',
    payItems: Array.from({ length: PAY_ITEM_ROW_COUNT }, () => ({
      itemNumber: '',
      description: '',
      qty: '',
      unit: '',
      // Only meaningful for a catalog item with Stations/Locations/Side/
      // Computed/Theoretical enabled (see project-file.js) -- blank and
      // unused otherwise.
      startStation: '',
      endStation: '',
      location: '',
      side: '',
      length: '',
      width: '',
      theoreticalQty: '',
      remarks: '',
    })),
    // Tests Performed: { name (one of TEST_TYPES), note }. Checks Completed:
    // { name (one of the project's checks), status 'done' | 'not' | 'na',
    // note }. Both start empty; they're the day's own record.
    tests: [],
    checks: [],
    controllingItem: meta.controllingItem || '',
    commentsOnTime: meta.commentsOnTime || '',
    controllingItemTimeFrom: meta.controllingItemTimeFrom || '',
    controllingItemTimeTo: meta.controllingItemTimeTo || '',
    workingConditions: meta.workingConditions || '',
    trafficControlSelect: meta.trafficControlSelect || null,
    workBegin: meta.workBegin || '',
    workEnd: meta.workEnd || '',
    repSignatureName: previous ? previous.representative : meta.representative || '',
    repSignatureImage: null,
    // No peSignatureImage: the engineer's signature line is left blank on the
    // printed report for them to sign -- inspectors don't sign for them.
    peSignatureName: previous ? previous.peName : meta.peName || '',
    weatherDesc: meta.weatherDesc || '',
    tempHigh: meta.tempHigh || '',
    tempLow: meta.tempLow || '',
    photos: blankPhotoSlots(),
    // A brand-new report has nothing to lazily fetch -- every slot is
    // locally authoritative already. A report pulled from a company
    // without downloading its photo bytes (see firebase-sync.js) sets
    // these to false for whichever slots it deferred; report-editor.html
    // fetches them on open, download.html before generating a PDF.
    photosFetched: fetchedPhotoSlots(),
    signatureFetched: true,
    // Small rendered previews of the report's first two printed pages
    // (front: the work report, back: the photo log), shown on reports.html.
    // Local-only -- never pushed to the company (see pushReportToCompany)
    // -- and regenerated whenever thumbnailAt stops matching updatedAt
    // (see ensureThumbnails in reports.html).
    thumbnail: null,
    thumbnailBack: null,
    thumbnailAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  // A project's Default Activity and Default Work Summary (top line) are
  // still two separately-set fields on the project file, so a brand-new
  // report can start with both filled and differing -- convergeField
  // leaves that alone rather than picking a winner, same as it would for a
  // legacy report, and only steps in when exactly one side came back blank.
  convergeLegacyReportFields(report);
  return report;
}

// Seeds a brand-new report from an existing one -- a true "same as
// yesterday, just tweak what changed" starting point. Copies everything:
// activity, notes, work summary, weather, contractors, equipment labels and
// quantities, pay item rows and quantities, inspector names/hours/time
// segments. The only things that deliberately stay blank are photos and
// both signature images -- carrying yesterday's photos or someone's actual
// signature onto today's report would be wrong regardless of how much else
// is meant to carry over.
async function duplicateReport(source, nextReportNo, project) {
  const room = typeof getCompanyRoom === 'function' ? await getCompanyRoom() : null;
  const companyCode = (project && project.companyCode) || (room && room.code) || null;

  // A pre-multi-inspector report has no `inspectors` array of its own --
  // same fold-in makeBlankReport/renderEditor already do, so there's always
  // at least one real entry to copy forward instead of ending up empty.
  const sourceInspectors = Array.isArray(source.inspectors) && source.inspectors.length
    ? source.inspectors
    : [{ name: source.representative || '', hours: source.hours, timeEntries: source.timeEntries || [{ start: '', end: '' }] }];
  const inspectors = sourceInspectors.map((insp) => ({
    name: insp.name || '',
    hours: insp.hours,
    timeEntries: (insp.timeEntries && insp.timeEntries.length ? insp.timeEntries : [{ start: '', end: '' }]).map((e) => ({ ...e })),
  }));
  const representative = inspectors.map((i) => i.name).filter((n) => n.trim()).join(', ');

  // Always exactly CONTRACTOR_COUNT entries -- the print template and
  // computeVisibleCounts (report-editor.html) both assume that invariant
  // holds for every report, the same one makeBlankReport itself guarantees;
  // a source predating the contractors feature entirely (no array at all)
  // otherwise silently breaks the new report's own editor page.
  const sourceContractors = Array.isArray(source.contractors) ? source.contractors : [];
  const contractors = Array.from({ length: CONTRACTOR_COUNT }, (_, i) => ({ name: (sourceContractors[i] && sourceContractors[i].name) || '' }));

  const report = {
    ...source,
    id: crypto.randomUUID(),
    projectId: project ? project.id : source.projectId,
    companyCode,
    reportNo: nextReportNo,
    date: todayIso(),
    representative,
    repSignatureName: representative,
    peSignatureName: source.peName || '',
    timeEntries: inspectors[0].timeEntries.map((e) => ({ ...e })),
    inspectors,
    contractors,
    equipmentRows: (source.equipmentRows || []).map((row) => ({
      label: row.label || '',
      qty: Array.isArray(row.qty) ? [...row.qty] : Array.from({ length: CONTRACTOR_COUNT }, () => ''),
    })),
    payItems: (source.payItems || []).map((it) => ({ ...it })),
    tests: [],
    checks: [],
    repSignatureImage: null,
    peSignatureImage: null,
    photos: blankPhotoSlots(),
    photosFetched: fetchedPhotoSlots(),
    signatureFetched: true,
    thumbnail: null,
    thumbnailBack: null,
    thumbnailAt: null,
    createdBy: undefined,
    lastEditedBy: undefined,
    createdByUid: undefined,
    lastEditedByUid: undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  // Covers a source report that predates the Activity/Work Summary link or
  // still had Short Work Summary content -- representative/PE name above are
  // already set explicitly, so this is a no-op for those.
  convergeLegacyReportFields(report);
  return report;
}

// ---------- Legacy field convergence ----------
//
// Activity/Work Summary (top line), Representative/Representative Name
// (sign-off), and PE Name/Project Engineer Name used to be independently
// typed twice for the same thing -- report-editor.html now shows one box
// for each pair (see REPORT_BUILDER_GROUPS below) and keeps the second
// field in sync live as the first is typed. This is what catches
// everything that predates that: a report saved before the link existed,
// where the two sides drifted apart, or simply started apart from two
// different project-file defaults.
//
// Only ever fills a blank side from a filled one -- never overwrites real
// content on either side, since a report that's already been signed/
// printed shouldn't have its printed text silently rewritten after the
// fact. If both sides already carry (possibly different) content, both are
// left exactly as they are.
function convergeField(report, primaryKey, secondaryKey) {
  const primary = String(report[primaryKey] || '').trim();
  const secondary = String(report[secondaryKey] || '').trim();
  if (!primary && secondary) report[primaryKey] = report[secondaryKey];
  else if (!secondary && primary) report[secondaryKey] = report[primaryKey];
}

function convergeLegacyReportFields(report) {
  // Short Work Summary is retired outright -- there's no third box it links
  // to going forward, so this is a one-time fold-in rather than a live
  // link: if it's the only place with real content, that content becomes
  // the Work Summary top line; either way it's cleared after, so it can
  // never keep printing on a report from here on. Done before the
  // Activity/Work Summary convergence below so its content gets first
  // claim on an empty top line rather than losing a race to it.
  if (String(report.trafficControlNote || '').trim() && !String(report.workSummaryHeader || '').trim()) {
    report.workSummaryHeader = report.trafficControlNote;
  }
  report.trafficControlNote = '';

  convergeField(report, 'activity', 'workSummaryHeader');
  convergeField(report, 'representative', 'repSignatureName');
  convergeField(report, 'peName', 'peSignatureName');
}

// Brings a stored report up to the current shape. Reports saved before the
// force/equipment table grew from 15 rows to the template's full 22 only hold
// 15, and older ones predate the work-summary header field entirely.
function normalizeReport(report) {
  if (!report) return report;
  // Only fills in when entirely absent (a report saved before this field
  // existed) -- an actual `false` from a lazy pull must survive this, not
  // get reset back to "fetched" just because normalizeReport ran again.
  if (!Array.isArray(report.photosFetched)) report.photosFetched = fetchedPhotoSlots();
  // Reports from before the 4 extra slots existed hold 6; the new slots
  // are empty, and known to be.
  if (!Array.isArray(report.photos)) report.photos = [];
  while (report.photos.length < REPORT_PHOTO_COUNT) report.photos.push(null);
  while (report.photosFetched.length < REPORT_PHOTO_COUNT) report.photosFetched.push(true);
  if (report.signatureFetched == null) report.signatureFetched = true;
  if (!Array.isArray(report.equipmentRows)) report.equipmentRows = [];
  while (report.equipmentRows.length < EQUIPMENT_ROW_COUNT) {
    report.equipmentRows.push({ label: '', qty: ['', '', '', '', '', ''] });
  }
  report.equipmentRows.length = EQUIPMENT_ROW_COUNT;
  // Same invariant as equipmentRows above -- computeVisibleCounts
  // (report-editor.html) and the print template both assume exactly
  // CONTRACTOR_COUNT entries; a report old enough to predate the
  // contractors feature entirely otherwise has none at all.
  if (!Array.isArray(report.contractors)) report.contractors = [];
  while (report.contractors.length < CONTRACTOR_COUNT) report.contractors.push({ name: '' });
  report.contractors.length = CONTRACTOR_COUNT;
  report.equipmentRows.forEach((row) => {
    if (!Array.isArray(row.qty)) row.qty = ['', '', '', '', '', ''];
    while (row.qty.length < CONTRACTOR_COUNT) row.qty.push('');
  });
  if (report.workSummaryHeader == null) report.workSummaryHeader = '';
  convergeLegacyReportFields(report);
  // Drop any engineer signature captured before that box was removed, so it
  // can't keep printing on a report the engineer never actually signed.
  delete report.peSignatureImage;
  return report;
}

// Builds a new project record from a parsed project-data file (see
// project-file.js).
//
// Projects used to carry a copy of the report template .xlsx. Nothing reads it
// any more -- the PDF is drawn entirely from print-layout.json -- so it's no
// longer stored, which also keeps it out of shared setups.
async function makeProjectFromParsedFile(parsed) {
  const meta = parsed.meta || {};
  const displayName = meta.name || (meta.projectNo ? `PR#${meta.projectNo} - ${meta.projectName || 'Project'}` : 'New Project');
  const room = typeof getCompanyRoom === 'function' ? await getCompanyRoom() : null;
  return {
    id: crypto.randomUUID(),
    companyCode: room ? room.code : null,
    name: displayName,
    meta: {
      projectNo: meta.projectNo || '',
      projectName: meta.projectName || '',
      ntpDate: meta.ntpDate || '',
      contractLength: meta.contractLength || '',
      representative: meta.representative || '',
      peName: meta.peName || '',
      activity: meta.activity || '',
      notes: meta.notes || '',
      workSummaryHeader: meta.workSummaryHeader || '',
      trafficControlNote: meta.trafficControlNote || '',
      workSummary: meta.workSummary || '',
      controllingItem: meta.controllingItem || '',
      commentsOnTime: meta.commentsOnTime || '',
      controllingItemTimeFrom: meta.controllingItemTimeFrom || '',
      controllingItemTimeTo: meta.controllingItemTimeTo || '',
      workingConditions: meta.workingConditions || '',
      trafficControlSelect: meta.trafficControlSelect || '',
      workBegin: meta.workBegin || '',
      workEnd: meta.workEnd || '',
      weatherDesc: meta.weatherDesc || '',
      tempHigh: meta.tempHigh || '',
      tempLow: meta.tempLow || '',
    },
    defaultContractors: parsed.contractors || [],
    defaultEquipmentLabels: parsed.equipmentLabels || [],
    payItemCatalog: parsed.payItemCatalog || [],
    // The Project Data file never carries billing history (see the Pay App
    // Quantities file on the Quantity Sheet page instead) -- a brand new
    // project just starts with none, same as one created from scratch.
    billingEstimates: [],
    requiredFields: [],
    hiddenFields: [],
    fieldOrder: [],
    backgroundImage: null,
    backgroundImageFetched: true, // nothing to fetch -- this project was just created locally
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Finds an existing project a freshly-parsed one probably represents a new
// version of, so re-uploading a project's file can update it in place
// instead of always creating a duplicate. Matched by project number first
// (the stable key project data files are built around), falling back to an
// exact name match for files that don't carry one.
function findSimilarProject(pool, candidate) {
  const projectNo = ((candidate.meta && candidate.meta.projectNo) || '').trim().toLowerCase();
  const name = (candidate.name || '').trim().toLowerCase();
  return (
    pool.find((p) => {
      const pNo = ((p.meta && p.meta.projectNo) || '').trim().toLowerCase();
      if (projectNo && pNo && projectNo === pNo) return true;
      return !!name && (p.name || '').trim().toLowerCase() === name;
    }) || null
  );
}

// Merges the Pay App Quantities file's rows (see parsePayAppQuantitiesSheet
// in project-file.js -- estimateNo/date/note/itemTotals, never an id) into
// the project's existing billing history by estimateNo, rather than
// replacing the array wholesale. A real billing estimate carries approval
// status and reviewer comments (see saveBillingEstimateApproval in
// storage.js) that the spreadsheet has no column for at all -- a wholesale
// replace would silently erase those on every single re-upload, which is
// exactly backwards for a file meant to make Pay Apps EASIER to keep up to
// date. An estimateNo already on file is updated in place (keeping its id/
// approvalStatus/comments); its approvalStatus resets to 'pending' if the
// actual content changed, same as hand-editing a Pay App in pay-apps.html
// already does. An estimateNo the file doesn't mention at all is left
// untouched -- this only ever adds to or updates billing history, never
// removes it just because a row got deleted from the sheet (deleting a Pay
// App is its own explicit action elsewhere, not a side effect of a
// re-upload).
function mergeBillingEstimates(existingList, fileRows) {
  const merged = (existingList || []).slice();
  const byNo = new Map(merged.map((e) => [String(e.estimateNo || '').trim(), e]));
  (fileRows || []).forEach((row) => {
    const key = String(row.estimateNo || '').trim();
    const match = key ? byNo.get(key) : null;
    const hasItemTotals = Object.prototype.hasOwnProperty.call(row, 'itemTotals');
    if (match) {
      const contentChanged = match.date !== row.date || match.note !== row.note
        || (hasItemTotals && JSON.stringify(match.itemTotals || {}) !== JSON.stringify(row.itemTotals || {}));
      if (!contentChanged) return; // nothing this row actually changes -- leave updatedAt alone too
      const updated = { ...match, date: row.date, note: row.note };
      if (hasItemTotals) updated.itemTotals = row.itemTotals;
      if (updated.approvalStatus) updated.approvalStatus = 'pending';
      // Its own activity marker, same as pay-apps.html's manual save sets on
      // the estimate object itself -- the Manager alert banner (common.js)
      // reads this to know which Pay App changed, not just that the project
      // as a whole did.
      updated.updatedAt = Date.now();
      merged[merged.indexOf(match)] = updated;
      byNo.set(key, updated);
    } else {
      const created = { id: crypto.randomUUID(), estimateNo: row.estimateNo, date: row.date, note: row.note, itemTotals: row.itemTotals, updatedAt: Date.now() };
      merged.push(created);
      if (key) byNo.set(key, created);
    }
  });
  return merged;
}

// Keeps the matched project's identity (id/createdAt) but adopts everything
// the new file carries -- this is what makes it an update rather than a
// second, separate project with the same content. Billing history is
// deliberately left out of that "everything": the Project Data file never
// carries it (see the Pay App Quantities file on the Quantity Sheet page,
// which uses mergeBillingEstimates above for its own, much narrower
// import), so a re-upload here can never touch it either way.
// Pay item settings a project file may not carry (an older file, or one
// from a DOTD spreadsheet): a setting the file has no column for keeps the
// project's current value. A confirmed unit only carries over while the
// unit text is unchanged.
const PAY_ITEM_KEPT_SETTINGS = ['unitKind', 'calcs', 'remarksRequired', 'dailyLimit', 'payAppOnly'];
function mergePayItemSettings(existingCatalog, newCatalog) {
  const before = new Map((existingCatalog || []).map((c) => [String(c.itemNumber || '').trim(), c]));
  return (newCatalog || []).map((item) => {
    const old = before.get(String(item.itemNumber || '').trim());
    if (!old) return item;
    const merged = { ...item };
    PAY_ITEM_KEPT_SETTINGS.forEach((key) => {
      if (merged[key] !== undefined || old[key] === undefined) return;
      if (key === 'unitKind' && String(old.unit || '').trim().toUpperCase() !== String(item.unit || '').trim().toUpperCase()) return;
      merged[key] = Array.isArray(old[key]) ? [...old[key]] : old[key];
    });
    if (merged.calcs === null) delete merged.calcs;
    return merged;
  });
}

function applyProjectUpdate(existing, candidate) {
  return {
    ...existing,
    name: candidate.name,
    meta: candidate.meta,
    payItemCatalog: mergePayItemSettings(existing.payItemCatalog, candidate.payItemCatalog),
    defaultContractors: candidate.defaultContractors,
    defaultEquipmentLabels: candidate.defaultEquipmentLabels,
  };
}

// Next Estimate No. to suggest when recording a new billing checkpoint --
// one past the highest existing number, formatted with the same digit
// width as the one it follows (so "001" stays "002", not "2"). Purely a
// suggestion; the field stays editable.
function nextEstimateNo(billingEstimates) {
  const nums = (billingEstimates || [])
    .map((e) => e.estimateNo || '')
    .filter((s) => /^\d+$/.test(s));
  if (nums.length === 0) return '001';
  const widest = nums.reduce((a, b) => (b.length > a.length ? b : a));
  const max = Math.max(...nums.map(Number));
  return String(max + 1).padStart(widest.length, '0');
}

// ---------- Required-field definitions ----------
//
// An admin marks a subset of these (per project, in project.requiredFields)
// via the visual picker on required-fields.html. Shared here so that page,
// report-editor.html's red-border highlighting, and its Generate Report gate
// all agree on the same key -> label -> "is it actually filled in" logic.
// ---------- Tests Performed and Checks Completed ----------

// The standard test names an inspector picks from (report.tests[].name), so
// the same test reads the same on every report and can be searched for.
// Grouped only for the picker; the name alone is saved and printed.
const TEST_TYPE_GROUPS = [
  ['Soils & Base', ['Nuclear Density (Soil)', 'Sand Cone Density', 'Proctor (Moisture-Density)', 'Moisture Content', 'Atterberg Limits', 'Sieve Analysis (Gradation)', 'Dynamic Cone Penetrometer (DCP)', 'Plate Load Test', 'Proof Roll', 'Stabilization Content (Lime/Cement)', 'Pulverization']],
  ['Concrete', ['Slump', 'Air Content', 'Concrete Temperature', 'Unit Weight', 'Cylinders Cast', 'Cylinder Breaks (Compressive Strength)', 'Beams Cast (Flexural)', 'Maturity Reading', 'Concrete Core']],
  ['Asphalt', ['Mix Temperature', 'Mat Temperature', 'Nuclear Density (Asphalt)', 'Asphalt Core', 'Rolling Pattern', 'Binder Content', 'Tack Rate', 'Thickness Check', 'Straightedge / Smoothness']],
  ['Pipe & Drainage', ['Mandrel (Deflection) Test', 'CCTV Video Inspection', 'Manhole Vacuum Test', 'Pipe Air Test', 'Leakage / Exfiltration Test', 'Joint Inspection']],
  ['Structures & Other', ['Rebar Inspection', 'Bolt Torque', 'Pile Driving Log', 'Coating Thickness', 'Retroreflectivity', 'Water Line Pressure Test', 'Other (describe)']],
];
const TEST_TYPES = TEST_TYPE_GROUPS.flatMap(([, list]) => list);

const CHECK_STATUS_LABELS = { done: 'Done', not: 'Not done', na: 'N/A' };

// The checks an admin set up for the project (Project Settings > Checks).
function projectChecks(project) {
  return ((project && project.checks) || []).map((c) => String(c || '').trim()).filter(Boolean);
}

function reportCheckStatus(report, name) {
  const c = ((report && report.checks) || []).find((x) => x && x.name === name);
  return c ? c.status || '' : '';
}

const REQUIRED_FIELD_DEFS = [
  { key: 'activity', label: 'Activity', isEmpty: (r) => !String(r.activity || '').trim() },
  { key: 'notes', label: 'Notes', isEmpty: (r) => !String(r.notes || '').trim() },
  { key: 'representative', label: 'Representative', isEmpty: (r) => !String(r.representative || '').trim() },
  { key: 'peName', label: 'PE Name', isEmpty: (r) => !String(r.peName || '').trim() },
  { key: 'ntpDate', label: 'NTP Date', isEmpty: (r) => !String(r.ntpDate || '').trim() },
  { key: 'contractors', label: 'Contractors (at least one named)', isEmpty: (r) => !Array.isArray(r.contractors) || r.contractors.every((c) => !c.name || !c.name.trim()) },
  { key: 'equipmentRows', label: 'Equipment (at least one quantity entered)', isEmpty: (r) => !Array.isArray(r.equipmentRows) || r.equipmentRows.every((row) => !Array.isArray(row.qty) || row.qty.every((q) => !String(q || '').trim())) },
  // Short Work Summary is retired (see convergeLegacyReportFields) -- no
  // entry here for it, since nothing on the form could ever fill it in to
  // satisfy a required check anymore. Work Summary (top line) stays: it's
  // linked to Activity now (see REPORT_BUILDER_GROUPS below), so it's kept
  // non-empty automatically the moment Activity is.
  { key: 'workSummaryHeader', label: 'Work Summary (top line)', isEmpty: (r) => !String(r.workSummaryHeader || '').trim() },
  { key: 'workSummary', label: 'Summary of Work Performed', isEmpty: (r) => !String(r.workSummary || '').trim() },
  { key: 'payItems', label: 'Pay Items (at least one entered)', isEmpty: (r) => !Array.isArray(r.payItems) || r.payItems.every((pi) => !((pi.itemNumber || pi.description) && String(pi.qty || '').trim())) },
  { key: 'controllingItem', label: 'Controlling Item', isEmpty: (r) => !String(r.controllingItem || '').trim() },
  { key: 'commentsOnTime', label: 'Comments on Time Charged', isEmpty: (r) => !String(r.commentsOnTime || '').trim() },
  { key: 'controllingItemTimeFrom', label: 'Controlling Item Time From', isEmpty: (r) => !String(r.controllingItemTimeFrom || '').trim() },
  { key: 'controllingItemTimeTo', label: 'Controlling Item Time To', isEmpty: (r) => !String(r.controllingItemTimeTo || '').trim() },
  { key: 'workingConditions', label: 'Working Conditions', isEmpty: (r) => !String(r.workingConditions || '').trim() },
  { key: 'trafficControlSelect', label: 'Traffic Control Status', isEmpty: (r) => !r.trafficControlSelect },
  { key: 'workBegin', label: 'Work Begin', isEmpty: (r) => !String(r.workBegin || '').trim() },
  { key: 'workEnd', label: 'Work End', isEmpty: (r) => !String(r.workEnd || '').trim() },
  { key: 'repSignatureName', label: 'Representative Name (sign-off)', isEmpty: (r) => !String(r.repSignatureName || '').trim() },
  { key: 'repSignatureImage', label: 'Representative Signature', isEmpty: (r) => !r.repSignatureImage },
  { key: 'peSignatureName', label: 'Project Engineer Name', isEmpty: (r) => !String(r.peSignatureName || '').trim() },
  { key: 'weatherDesc', label: 'Weather Description', isEmpty: (r) => !String(r.weatherDesc || '').trim() },
  { key: 'tempHigh', label: 'High Temp', isEmpty: (r) => !String(r.tempHigh ?? '').trim() },
  { key: 'tempLow', label: 'Low Temp', isEmpty: (r) => !String(r.tempLow ?? '').trim() },
  { key: 'photos', label: 'Photos (at least one)', isEmpty: (r) => !Array.isArray(r.photos) || r.photos.every((p) => !p) },
  { key: 'tests', label: 'Tests Performed (at least one)', isEmpty: (r) => !(r.tests || []).some((t) => t && t.name) },
  { key: 'checks', label: 'Checks Completed (every check marked)', isEmpty: (r, p) => projectChecks(p).some((name) => !reportCheckStatus(r, name)) },
];

// ---------- Field visibility & order (admin-configurable, per project) ----------
//
// Contractors and Equipment share one entry here ('contractorsEquipment')
// even though REQUIRED_FIELD_DEFS above tracks them separately -- on the
// actual report-editor.html form they're one physical widget (a tab picks
// the contractor, equipment quantities are per-tab), so they can only be
// shown/hidden/repositioned as a unit. They can still be marked required
// independently -- that's a finer distinction than the widget's layout has
// to support.
const ORDERABLE_FIELD_DEFS = [
  { key: 'activity', label: 'Activity', kind: 'simple' },
  { key: 'notes', label: 'Notes', kind: 'simple' },
  { key: 'representative', label: 'Representative', kind: 'simple' },
  { key: 'peName', label: 'PE Name', kind: 'simple' },
  { key: 'ntpDate', label: 'NTP Date', kind: 'simple' },
  { key: 'contractorsEquipment', label: 'Contractors & Equipment', kind: 'block' },
  // Work Summary (top line), Short Work Summary, Representative Name, and
  // Project Engineer Name used to be their own orderable/hideable fields
  // here -- they're not any more (see convergeLegacyReportFields): the
  // first is linked to Activity, the last two to Representative/PE Name,
  // and Short Work Summary is retired outright. Nothing left for an admin
  // to independently show/hide/reorder/require for any of them.
  { key: 'workSummary', label: 'Summary of Work Performed', kind: 'simple' },
  { key: 'payItems', label: 'Pay Items', kind: 'block' },
  { key: 'tests', label: 'Tests Performed', kind: 'block' },
  { key: 'checks', label: 'Checks Completed', kind: 'block' },
  { key: 'controllingItem', label: 'Controlling Item', kind: 'simple' },
  { key: 'commentsOnTime', label: 'Comments on Time Charged', kind: 'simple' },
  { key: 'controllingItemTimeFrom', label: 'Controlling Item Time From', kind: 'simple' },
  { key: 'controllingItemTimeTo', label: 'Controlling Item Time To', kind: 'simple' },
  { key: 'workingConditions', label: 'Working Conditions', kind: 'simple' },
  { key: 'trafficControlSelect', label: 'Traffic Control Status', kind: 'block' },
  { key: 'workBegin', label: 'Work Begin', kind: 'simple' },
  { key: 'workEnd', label: 'Work End', kind: 'simple' },
  { key: 'repSignatureImage', label: 'Representative Signature', kind: 'block' },
  { key: 'weatherDesc', label: 'Weather Description', kind: 'simple' },
  { key: 'tempHigh', label: 'High Temp', kind: 'simple' },
  { key: 'tempLow', label: 'Low Temp', kind: 'simple' },
  { key: 'photos', label: 'Photos', kind: 'block' },
];
const DEFAULT_FIELD_ORDER = ORDERABLE_FIELD_DEFS.map((d) => d.key);

// report-editor.html's desktop layout clusters ORDERABLE_FIELD_DEFS keys
// into these fixed, thematic groups (each its own collapsible card) rather
// than one flat step per field -- this is a *display* grouping only, a
// separate concern from the field order/hidden/required config above,
// which admins still fully control per field. A group with every one of
// its keys hidden simply doesn't render; keys within a group still render
// in whatever order the admin set. Every ORDERABLE_FIELD_DEFS key must
// appear in exactly one group here.
// Tests Performed and Checks Completed sit right after Work Summary: they
// print inside the Work Summary box, under the pay item table.
const REPORT_BUILDER_GROUPS = [
  { id: 'payItems', icon: '\u{1F4CA}', label: 'Pay Items', keys: ['payItems'], hint: "What was worked on today and how much. Stations, sizes and remarks print on the line under each item. The printed table sits under the Work Summary and grows with the list; the text shrinks to fit when needed." },
  { id: 'overview', icon: '\u{1F4DD}', label: 'Overview', keys: ['activity', 'notes', 'representative', 'peName', 'ntpDate'] },
  { id: 'contractorsEquipment', icon: '\u{1F477}', label: 'Contractors & Equipment', keys: ['contractorsEquipment'], hint: '22 personnel/equipment rows are fixed by the template, but only ones already in use show by default -- use the "+" buttons to reveal more. You can rename any row, and quantities are per contractor tab.' },
  { id: 'workSummary', icon: '\u{270D}\u{FE0F}', label: 'Work Summary', keys: ['workSummary'] },
  { id: 'tests', icon: '\u{1F9EA}', label: 'Tests Performed', keys: ['tests'], hint: 'Pick each test from the list so it has the same name on every report, then note the location, results or sample numbers. Prints under the pay items.' },
  { id: 'checks', icon: '\u{2705}', label: 'Checks Completed', keys: ['checks'], hint: "This project's checks (set in Project Settings). Mark each one Done, Not done or N/A. Prints under the tests." },
  { id: 'controllingItem', icon: '\u{23F1}\u{FE0F}', label: 'Controlling Item & Time Charged', keys: ['controllingItem', 'commentsOnTime', 'controllingItemTimeFrom', 'controllingItemTimeTo'] },
  { id: 'siteConditions', icon: '\u{1F6A7}', label: 'Site Conditions', keys: ['workingConditions', 'trafficControlSelect', 'workBegin', 'workEnd'] },
  { id: 'weather', icon: '\u{1F324}\u{FE0F}', label: 'Weather', keys: ['weatherDesc', 'tempHigh', 'tempLow'] },
  { id: 'signOff', icon: '\u{1F58B}\u{FE0F}', label: 'Sign-Off', keys: ['repSignatureImage'] },
  { id: 'photos', icon: '\u{1F4F7}', label: 'Photos', keys: ['photos'] },
];

// A required-field key that isn't its own orderable block (contractors,
// equipmentRows) resolves to the block that actually controls whether it's
// on the form at all.
const REQUIRED_TO_BLOCK_KEY = { contractors: 'contractorsEquipment', equipmentRows: 'contractorsEquipment' };
function blockKeyFor(requiredKey) {
  return REQUIRED_TO_BLOCK_KEY[requiredKey] || requiredKey;
}

// Saved order, with any keys the admin never touched (new app version added
// one, or this project predates the feature) appended at the end in their
// default position rather than silently dropped.
function getFieldOrder(project) {
  const saved = (project && Array.isArray(project.fieldOrder) && project.fieldOrder) || [];
  const known = new Set(DEFAULT_FIELD_ORDER);
  const savedValid = saved.filter((k) => known.has(k));
  const missing = DEFAULT_FIELD_ORDER.filter((k) => !savedValid.includes(k));
  return [...savedValid, ...missing];
}

function isFieldHidden(project, key) {
  return ((project && project.hiddenFields) || []).includes(blockKeyFor(key));
}

// Which of a project's marked-required fields this particular report hasn't
// filled in yet -- empty array means it's good to generate. A required field
// whose block the admin later hid is never enforced -- there'd be no way
// left on the form to satisfy it. A No Work Day/Weather Day report is
// deliberately blank apart from Notes and Hours (see the report-editor.html
// buttons) -- required-field checks would otherwise block generating one on
// any project that requires, say, Activity or Pay Items, which defeats the
// point of marking a day as one in the first place.
function getMissingRequiredFields(report, project) {
  const required = (project && project.requiredFields) || [];
  if (!report || isNoWorkDayReport(report) || isWeatherDayReport(report)) return [];
  const missing = REQUIRED_FIELD_DEFS.filter(
    (def) => required.includes(def.key) && !isFieldHidden(project, def.key) && def.isEmpty(report, project)
  );
  // Pay items whose catalog entry asks for remarks (Project Settings).
  if (!isFieldHidden(project, 'payItems')) {
    const catalog = new Map(((project && project.payItemCatalog) || []).map((c) => [c.itemNumber, c]));
    const seen = new Set();
    (report.payItems || []).forEach((pi) => {
      const cat = pi && pi.itemNumber && catalog.get(pi.itemNumber);
      if (!cat || !cat.remarksRequired || String(pi.remarks || '').trim() || seen.has(pi.itemNumber)) return;
      seen.add(pi.itemNumber);
      missing.push({ key: 'payItems', label: `Remarks for pay item ${pi.itemNumber}` });
    });
  }
  return missing;
}
