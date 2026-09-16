// Builds the styled Quantity Sheet workbook (Cover/Totals/By Day/By
// Estimate/Detail Log) via ExcelJS. Shared by quantity-sheet.html's own
// Download button and local-sync.js's folder/zip sync -- both need the
// exact same workbook (down to column order), so it lives here once rather
// than as two copies that could drift apart. Depends on quantity-calc.js
// (aggregatePayItemTotals, fullPayItemCatalogOverview, etc.) and the global
// ExcelJS from lib/exceljs.min.js -- callers load both first.

const NO_DATE_KEY = '';

function compareDateKeys(a, b) {
  if (a === NO_DATE_KEY) return 1; // undated reports sort last
  if (b === NO_DATE_KEY) return -1;
  return a.localeCompare(b);
}

function displayDate(iso) {
  if (iso === NO_DATE_KEY) return 'No Date';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

// ---------- Workbook styling helpers ----------
// ExcelJS (unlike the SheetJS build used elsewhere in this app) actually
// writes cell styling into the .xlsx it produces, so the exported sheets can
// look like something a person laid out rather than a raw data dump: a
// brand-colored header row, light zebra striping down data rows, and thin
// gridlines that print cleanly. Kept as small helpers so every sheet below
// gets the same treatment instead of restyling it by hand each time.
const BRAND_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1C3D5A' } };
const ZEBRA_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F5F7' } };
const GRID_BORDER = { style: 'thin', color: { argb: 'FFDCE1E6' } };

function styleHeaderRow(ws, rowNum, lastCol) {
  const row = ws.getRow(rowNum);
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = BRAND_FILL;
    cell.alignment = { vertical: 'middle' };
    cell.border = { top: GRID_BORDER, left: GRID_BORDER, bottom: GRID_BORDER, right: GRID_BORDER };
  }
  row.height = 20;
}

// Thin gridlines plus alternating row shading across a data range -- makes
// a wide sheet (By Day, Detail Log) far easier to read across than SheetJS's
// bare, borderless output ever was.
function styleDataRows(ws, firstRow, lastRow, lastCol) {
  for (let r = firstRow; r <= lastRow; r++) {
    const shaded = (r - firstRow) % 2 === 1;
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws.getCell(r, c);
      cell.border = { top: GRID_BORDER, left: GRID_BORDER, bottom: GRID_BORDER, right: GRID_BORDER };
      if (shaded) cell.fill = ZEBRA_FILL;
    }
  }
}

// Which billing estimate (if any) a given date falls under -- the first
// recorded estimate whose date is on or after it. Blank if the date is
// past every recorded estimate (not billed yet) or none exist at all.
function estimateNoForDate(sortedList, date) {
  if (!date) return '';
  const hit = sortedList.find((e) => date <= e.date);
  return hit ? hit.estimateNo : '';
}

// The device's report logo (settings.html/company-management.html), turned
// into whatever ExcelJS's addImage actually accepts -- an arbitrary
// uploaded image could be any format (HEIC already converted away by the
// time it's saved, but still PNG/JPEG/WebP/etc.), and ExcelJS only embeds
// jpeg/png/gif, so it's redrawn through a canvas to normalize on PNG
// regardless of the original. Scaled down to a sane on-page size here too,
// rather than embedding a multi-megapixel photo at full resolution into
// every download. Never blocks the export -- a broken or missing logo just
// means no logo, not a failed download.
async function loadCoverLogoImage() {
  try {
    const blob = await getReportLogo();
    if (!blob) return null;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const buffer = await pngBlob.arrayBuffer();
    const maxWidth = 160, maxHeight = 80;
    const scale = Math.min(1, maxWidth / bitmap.width, maxHeight / bitmap.height);
    return { buffer, width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) };
  } catch (err) {
    console.error('cover logo:', err);
    return null;
  }
}

// A plain FIELD/VALUE header page -- project/company identity, the range
// this workbook covers, and a short table of contents, so the workbook
// still makes sense to someone who opens it with no other context (a
// contractor's biller, an auditor) months later.
async function buildCoverSheet(wb, project, room, dates, items, contentsLines) {
  const realDates = dates.filter((d) => d !== NO_DATE_KEY);
  const { totalContract, totalEarned } = contractValueSummary(items);
  const overall = overallPercentComplete(items);

  const ws = wb.addWorksheet('Cover', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 3 }, { width: 26 }, { width: 62 }];

  // Logo (if any) sits above the title, reserving just enough rows for its
  // own scaled height (~20px/row at the default row height) plus a little
  // padding -- the title/subtitle/everything below just shifts down by
  // however many extra rows that took, rather than needing two separate
  // layouts.
  const logo = await loadCoverLogoImage();
  let titleRow = 2;
  if (logo) {
    const imageId = wb.addImage({ buffer: logo.buffer, extension: 'png' });
    ws.addImage(imageId, { tl: { col: 1, row: 0.15 }, ext: { width: logo.width, height: logo.height } });
    titleRow = 2 + Math.max(3, Math.ceil(logo.height / 20) + 1);
  }

  ws.mergeCells(`B${titleRow}:C${titleRow}`);
  ws.getCell(`B${titleRow}`).value = 'Pay Item Quantity & Billing Report';
  ws.getCell(`B${titleRow}`).font = { bold: true, size: 16, color: { argb: 'FF1C3D5A' } };
  ws.mergeCells(`B${titleRow + 1}:C${titleRow + 1}`);
  ws.getCell(`B${titleRow + 1}`).value = 'Generated from Daily Work Reports';
  ws.getCell(`B${titleRow + 1}`).font = { italic: true, color: { argb: 'FF6E7A85' } };
  ws.getRow(titleRow).height = 24;

  // [label, value, numFmt] -- null entries are blank spacer rows, same
  // grouping the plain-text version used.
  const fieldRows = [
    ['Project', project.name || ''],
    ['Project No.', project.meta.projectNo || ''],
    ['Company', (room && room.name) || ''],
    ['Representative', project.meta.representative || ''],
    ['PE Name', project.meta.peName || ''],
    null,
    ['Report Range', realDates.length ? `${realDates[0]} to ${realDates[realDates.length - 1]}  (${realDates.length} reporting days)` : 'No dated reports in range'],
    ['Generated', new Date().toLocaleString()],
    ['Pay Items With Activity', String(items.length)],
    null,
    ['Overall % Complete', overall != null ? overall : 'N/A -- no Per Plans Total on file', overall != null ? '0.0%' : null],
    ['Total Contract Value', totalContract != null ? totalContract : 'N/A -- no Unit Price on file', totalContract != null ? '$#,##0.00' : null],
    ['Total Earned to Date', totalEarned != null ? totalEarned : 'N/A -- no Unit Price on file', totalEarned != null ? '$#,##0.00' : null],
  ];

  let r = titleRow + 3;
  fieldRows.forEach((entry) => {
    if (!entry) { r++; return; }
    const [label, value, fmt] = entry;
    ws.getCell(r, 2).value = label;
    ws.getCell(r, 2).font = { bold: true };
    ws.getCell(r, 3).value = value;
    if (fmt) ws.getCell(r, 3).numFmt = fmt;
    r++;
  });

  r++;
  ws.getCell(r, 2).value = 'Contents';
  ws.getCell(r, 2).font = { bold: true, size: 12, color: { argb: 'FF1C3D5A' } };
  r++;
  contentsLines.forEach(([sheet, desc]) => {
    ws.getCell(r, 2).value = sheet;
    ws.getCell(r, 2).font = { bold: true };
    ws.getCell(r, 3).value = desc;
    ws.getCell(r, 3).alignment = { wrapText: true };
    r++;
  });
}

// Builds the workbook from the selected reports. Reports sharing a calendar
// date are merged rather than kept separate -- "day" is the unit here, not
// "report". Five sheets: Cover (project/company header + contents), Totals
// (each item summed, % complete, and Overrun for items that track
// Theoretical Qty), By Day (one column per day), By Estimate (one column
// per billing checkpoint, skipped entirely if none are recorded), and
// Detail Log (every individual entry, filterable by any column -- station,
// side, date, estimate, inspector).
async function buildQuantitySheetWorkbook(reports, project, room, options) {
  const { showZero = false, includeByDay = true, includeDetail = true } = options || {};
  const byDate = new Map(); // date -> flat array of pay-item entries, each tagged with its report
  for (const r of reports) {
    const date = r.date || NO_DATE_KEY;
    const entries = (r.payItems || [])
      .filter((it) => it && String(it.itemNumber || '').trim() !== '')
      .map((it) => ({ ...it, __report: r }));
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(...entries);
  }
  const dates = Array.from(byDate.keys()).sort(compareDateKeys);

  // Flattened in the same order as the By Day columns (chronological,
  // undated last) so "first seen" means the same thing in both sheets.
  const flatItems = dates.flatMap((date) => byDate.get(date));
  // showZero pulls in the full catalog (with zeros filled in for anything
  // untouched this range) instead of just what's actually been logged --
  // same choice the on-screen tabs make via itemsForFlat, kept independent
  // here since this function also runs standalone in tests.
  const items = showZero
    ? fullPayItemCatalogOverview(flatItems, project.payItemCatalog)
    : aggregatePayItemTotals(flatItems, project.payItemCatalog);
  if (items.length === 0) return null;
  const itemOrder = items.map((it) => it.itemNumber);
  const catalogByNumber = new Map((project.payItemCatalog || []).map((c) => [c.itemNumber, c]));

  const perDateQty = new Map(); // date -> Map(itemNumber -> that day's own qty)
  for (const date of dates) {
    const dayMap = new Map();
    itemOrder.forEach((k) => dayMap.set(k, 0));
    for (const it of byDate.get(date)) {
      const key = String(it.itemNumber).trim();
      dayMap.set(key, dayMap.get(key) + (Number(it.qty) || 0));
    }
    perDateQty.set(date, dayMap);
  }

  // Computed up front (not just where each sheet needs it) so Cover -- built
  // first, unlike the old SheetJS version which had to append it last and
  // then move it, since SheetJS had no insert-at-index for sheets -- can
  // reference it too.
  const sortedBillingEstimates = sortedEstimates(project.billingEstimates);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Daily Work Reports';
  wb.created = new Date();

  // Cover first so it reads like an actual cover page when the file opens.
  await buildCoverSheet(wb, project, room, dates, items, [
    ['Totals', 'Summed quantity per pay item, with % complete and Overrun where tracked'],
    ...(includeByDay ? [['By Day', 'Quantity per item, one column per reporting day']] : []),
    ...(sortedBillingEstimates.length > 0 ? [['By Estimate', 'Quantity per item, one column per billing period']] : []),
    ...(includeDetail ? [['Detail Log', 'Every logged entry -- station, side, date, inspector, filterable']] : []),
  ]);

  // ---------- Totals ----------
  // Column order matches how the field actually reads it: item # and
  // description first, then what was planned, then what's been used against
  // it (to-date and what's left), then the two completion measures.
  const totalsWs = wb.addWorksheet('Totals', { views: [{ state: 'frozen', ySplit: 1 }] });
  totalsWs.columns = [
    { header: 'Item Number', width: 16 },
    { header: 'Description', width: 42 },
    { header: 'Per Plans Total', width: 16 },
    { header: 'Unit', width: 8 },
    { header: 'Total Quantity', width: 14 },
    { header: 'Remaining Quantity', width: 16 },
    { header: '% Complete', width: 12 },
    { header: 'Overrun/Underrun', width: 15 },
  ];
  items.forEach((it) => {
    const remaining = it.planned != null ? Math.round((it.planned - it.total) * 1000) / 1000 : '';
    const row = totalsWs.addRow([
      it.itemNumber, it.description,
      it.planned != null ? it.planned : '',
      it.unit, it.total, remaining,
      it.pct != null ? it.pct : '',
      it.overrun != null ? it.overrun : '',
    ]);
    row.getCell(7).numFmt = '0.0%';
  });
  const itemRowCount = items.length;
  totalsWs.addRow([]);
  const overall = overallPercentComplete(items);
  const overallRow = totalsWs.addRow(['', '', '', '', '', 'Overall % Complete', overall != null ? overall : '', '']);
  overallRow.font = { bold: true };
  overallRow.getCell(7).numFmt = '0.0%';
  styleHeaderRow(totalsWs, 1, 8);
  styleDataRows(totalsWs, 2, 1 + itemRowCount, 8);
  totalsWs.autoFilter = { from: 'A1', to: { row: 1 + itemRowCount, column: 8 } };

  // ---------- By Day ----------
  if (includeByDay) {
    const matrixWs = wb.addWorksheet('By Day', { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] });
    matrixWs.columns = [
      { header: 'Item Number', width: 16 },
      { header: 'Description', width: 42 },
      { header: 'Unit', width: 8 },
      ...dates.map((d) => ({ header: displayDate(d), width: 12 })),
    ];
    items.forEach((it) => {
      const row = [it.itemNumber, it.description, it.unit];
      dates.forEach((date) => row.push(perDateQty.get(date).get(it.itemNumber)));
      matrixWs.addRow(row);
    });
    styleHeaderRow(matrixWs, 1, matrixWs.columns.length);
    styleDataRows(matrixWs, 2, 1 + items.length, matrixWs.columns.length);
  }

  // ---------- By Estimate ----------
  if (sortedBillingEstimates.length > 0) {
    const perEstimateQty = sortedBillingEstimates.map((e) => {
      const bounds = estimatePeriodBounds(project.billingEstimates, e.id);
      const periodItems = flatItems.filter((it) => it.__report.date && (!bounds.periodFrom || it.__report.date > bounds.periodFrom) && it.__report.date <= bounds.periodTo);
      const dayMap = new Map();
      itemOrder.forEach((k) => dayMap.set(k, 0));
      for (const it of periodItems) {
        const key = String(it.itemNumber).trim();
        dayMap.set(key, dayMap.get(key) + (Number(it.qty) || 0));
      }
      return dayMap;
    });
    const estWs = wb.addWorksheet('By Estimate', { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] });
    estWs.columns = [
      { header: 'Item Number', width: 16 },
      { header: 'Description', width: 42 },
      { header: 'Unit', width: 8 },
      ...sortedBillingEstimates.map((e) => ({ header: `Est. ${e.estimateNo} (${e.date})`, width: 16 })),
    ];
    items.forEach((it) => {
      const row = [it.itemNumber, it.description, it.unit];
      perEstimateQty.forEach((dayMap) => row.push(dayMap.get(it.itemNumber)));
      estWs.addRow(row);
    });
    styleHeaderRow(estWs, 1, estWs.columns.length);
    styleDataRows(estWs, 2, 1 + items.length, estWs.columns.length);
  }

  // ---------- Detail Log ----------
  if (includeDetail) {
    const detailWs = wb.addWorksheet('Detail Log', { views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }] });
    detailWs.columns = [
      { header: 'Item Number', width: 14 }, { header: 'Description', width: 40 },
      { header: 'Date', width: 12 }, { header: 'Station', width: 10 }, { header: 'Stop Station', width: 12 },
      { header: 'Side', width: 6 }, { header: 'Length', width: 8 }, { header: 'Width', width: 7 },
      { header: 'Qty', width: 8 }, { header: 'Unit', width: 7 }, { header: 'Theoretical Qty', width: 14 },
      { header: 'Overrun/Underrun', width: 15 }, { header: 'Estimate No.', width: 11 }, { header: 'Inspector', width: 16 },
    ];
    const sortedFlat = flatItems.slice().sort((a, b) => {
      const byItem = String(a.itemNumber).localeCompare(String(b.itemNumber), undefined, { numeric: true });
      if (byItem !== 0) return byItem;
      return (a.__report.date || '').localeCompare(b.__report.date || '');
    });
    sortedFlat.forEach((it) => {
      const overrun = it.theoreticalQty ? computeOverrun(it.qty, it.theoreticalQty) : '';
      detailWs.addRow([
        it.itemNumber, it.description, it.__report.date || '',
        it.startStation || '', it.endStation || '', it.side || '',
        it.length || '', it.width || '', Number(it.qty) || 0, it.unit || '',
        it.theoreticalQty || '', overrun != null ? overrun : '',
        estimateNoForDate(sortedBillingEstimates, it.__report.date), it.__report.representative || '',
      ]);
    });
    styleHeaderRow(detailWs, 1, detailWs.columns.length);
    styleDataRows(detailWs, 2, 1 + sortedFlat.length, detailWs.columns.length);
    detailWs.autoFilter = { from: 'A1', to: { row: 1 + sortedFlat.length, column: detailWs.columns.length } };
  }

  return { wb, dates };
}
