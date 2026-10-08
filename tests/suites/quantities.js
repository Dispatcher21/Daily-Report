// The Quantities and Pay Apps pages, on the tutorial's example project (no
// company needed): logged vs billed figures, the item history, By Day,
// the Excel downloads, Log Quantities' running totals, and phone layout.
const { OUT, launchBrowser } = require('../harness');
const B = 'http://127.0.0.1:8126';
let fails = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (wanted ${JSON.stringify(want)})`}`); };
const text = (p, sel) => p.textContent(sel).then((t) => t.replace(/\s+/g, ' ').trim());

(async () => {
  const browser = await launchBrowser();
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => { errs.push(`dialog: ${d.message()}`); d.dismiss(); });
  await p.goto(`${B}/tutorial.html`);
  await p.waitForURL(/index\.html/, { timeout: 90000 });
  await p.waitForTimeout(1000);
  const pid = await p.evaluate(async () => (await getAllProjects()).find((pr) => pr.meta.projectNo === 'DEMO-101').id);
  check('example projects, DEMO-101 first', await p.evaluate(async () => (await getAllProjects()).map((pr) => pr.meta.projectNo)), ['DEMO-101', 'DEI-0001', 'NYC-1984', 'PAW-0048', 'OZ-1900', 'MOR-0001', 'TAT-0042', 'SHIRE-007']);
  const settle = () => p.waitForTimeout(1500);

  // The welcome asks inspector or manager. Picking one switches the
  // example company to that role's default permissions (the page reloads to
  // show it), and the tours after that only play that role's lines.
  await p.waitForSelector('.tour-root', { timeout: 15000 });
  await p.evaluate(() => tour.finishTyping()); // a tap while typing only finishes the line
  await p.click('.tour-next');
  check('welcome asks for a role', [await p.isVisible('.tour-choose-inspector'), await p.isVisible('.tour-choose-manager'), await p.isVisible('.tour-choose-guided')], [true, true, false]);
  await p.click('.tour-choose-inspector');
  await p.waitForSelector('.tour-choose-guided', { timeout: 15000 });
  await p.evaluate(() => tour.finishTyping());
  check('then the inspector welcome, walkthrough or explore', (await text(p, '.tour-text')).includes('everyday field work'), true);
  await settle();
  const homeLines = () => p.evaluate(() => tourStepsForPage('index.html').map((s) => s.say));
  await p.click('#hamburger-btn');
  check('inspector: no Manager Dashboard, Manager page or approving', [await p.isVisible('#md-overview-step'), await p.isVisible('#hb-manager-row'), await p.evaluate(() => companyCan('approveReports')), (await homeLines()).some((t) => t.includes('Manager Dashboard'))], [false, false, false, false]);
  check('inspector walkthrough: project page leads to New Report, editor ends at Generate', await p.evaluate(() => [tourStepsForPage('project.html').slice(-1)[0].say.includes('Tap New Report'), tourStepsForPage('report-editor.html').slice(-1)[0].say.includes('Generate Report')]), [true, true]);
  await p.click('.tour-choose-explore');
  // Same for a manager (straight to the role switch the button makes).
  await p.evaluate(async () => { sessionStorage.setItem('dr-tour-role', 'manager'); await applyTutorialRole('manager'); });
  await p.reload(); await settle();
  await p.click('#hamburger-btn');
  check('manager: Manager Dashboard, Manager page and approving', [await p.isVisible('#md-overview-step'), await p.isVisible('#hb-manager-row'), await p.evaluate(() => companyCan('approveReports')), (await homeLines()).some((t) => t.includes('Manager Dashboard'))], [true, true, true, true]);
  check('manager walkthrough: new project, then reviews with the emails, no Pay Apps', await p.evaluate(() => {
    const lines = ['index.html', 'project-setup.html', 'manager.html', 'report-viewer.html'].flatMap((pg) => tourStepsForPage(pg).map((st) => st.say));
    return [lines.some((t) => t.includes('Add Project')), lines.some((t) => t.includes('emails the inspector')), lines.some((t) => t.includes('weekly roundup')), lines.some((t) => /Pay App/.test(t))];
  }), [true, true, true, false]);
  // The rest of this suite is about quantities: back to the admin view.
  await p.evaluate(() => saveSetting(COMPANY_ADMIN_SETTING, true));

  // Project page cards.
  await p.goto(`${B}/project.html?id=${pid}`); await settle();
  check('Quantities card', await text(p, '#card-quantities-desc'), '49.5% logged · $201,345');
  check('Pay Apps card', await text(p, '#card-payapps-desc'), '44.5% billed · Pay App 2: Changes Requested');
  // Dashboard: Pay App 2 has Changes Requested, so Pay App 1 plus the
  // reports since stand (asphalt shows the 440 logged, not Pay App 2's 300).
  check('dashboard says where its figures come from', (await text(p, '#dash-pi-basis')).startsWith('Pay App 1 ('), true);
  check('disputed Pay App does not overrule the logs', await p.$$eval('#dash-pi-bars .bar-row, .bar-row', (rows) => rows.map((r) => r.textContent.replace(/\s+/g, ' ')).find((t) => t.includes('502-01')) || '').then((t) => t.includes('440 of 650 TON')), true);
  check('cards link to the pages', [await p.getAttribute('#card-quantities', 'href'), await p.getAttribute('#card-payapps', 'href')], [`quantity-sheet.html?project=${pid}`, `pay-apps.html?project=${pid}`]);

  // Quantities.
  await p.goto(`${B}/quantity-sheet.html?project=${pid}`); await settle();
  check('opens on Since Last Pay App', await p.getAttribute('[data-range="sincepa"]', 'aria-pressed'), 'true');
  check('tabs', await text(p, '#qp-tabs'), 'Quantities 49% logged Pay Apps 44% billed');
  const cbar = await text(p, '#qty-cbar');
  check('contract bar', [cbar.includes('Contract $407,050'), cbar.includes('Billed $181,045'), cbar.includes('Logged, not billed yet $20,300'), cbar.includes('Remaining $205,705')], [true, true, true, true]);
  check('since last Pay App: only asphalt', await p.$$eval('button.qs-row', (rows) => rows.map((r) => r.dataset.item)), ['502-01']);
  check('asphalt check chip', await text(p, 'button.qs-row[data-item="502-01"] .qp-chk'), '140 TON to bill');
  await p.click('[data-range="all"]');
  check('All: every item', (await p.$$('button.qs-row')).length, 6);
  check('matching items', await p.$$eval('.qp-chk-ok', (els) => els.length), 5);
  await p.click('button.qs-row[data-item="502-01"]');
  const ledger = await p.$$eval('.qs-ledger tbody tr', (rows) => rows.map((r) => [...r.cells].map((c) => c.textContent.replace(/\s+/g, ' ').trim())));
  check('history: reports and the Pay App in date order', ledger.map((r) => r[1]), ['Report #16', 'Report #17', 'Pay App 2', 'Report #18', 'Report #19']);
  check('history: billed ahead at Pay App 2', ledger[2].slice(2), ['billed +300 TON', '244 TON', '300 TON']);
  check('history: totals end at 440 logged, 300 billed', ledger[4].slice(3), ['440 TON', '300 TON']);
  await p.click('#view-picker [data-view="byDay"]');
  check('By Day: a row per report', await p.$$eval('.qs-byday tbody tr', (r) => r.length), 19);
  check('By Day: asphalt total', await p.$eval('.qs-byday tfoot', (f) => f.textContent.includes('440')), true);
  await p.click('#view-picker [data-view="items"]');
  await p.fill('#qty-search', 'catch');
  check('search', await p.$$eval('button.qs-row', (rows) => rows.map((r) => r.dataset.item)), ['702-01']);
  await p.fill('#qty-search', '');
  await p.click('#btn-export');
  check('Excel dialog', await text(p, '#export-range'), '19 reports (all reports). Choose which sheets to include.');
  const [xlsx] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('#btn-generate')]);
  check('Excel download', /QuantitySheet_.*\.xlsx$/.test(xlsx.suggestedFilename()), true);
  await p.screenshot({ path: `${OUT}/quantities-desktop.png`, fullPage: true });

  // Pay Apps: the newest opens on its own.
  await p.goto(`${B}/pay-apps.html?project=${pid}`); await settle();
  check('newest Pay App open', await text(p, '#pa-detail-title'), 'Pay App 2');
  const pbar = await text(p, '#pa-cbar');
  check('contract bar as of Pay App 2', [pbar.includes('Billed $181,045'), pbar.includes('Billed ahead of logs $8,120')], [true, true]);
  check('asphalt billed ahead', await text(p, '.pa-bd-row[data-item="502-01"] .qp-chk'), '56 TON billed ahead');
  const period = await p.getAttribute('#pa-period-link', 'href');
  check('period link', /quantity-sheet\.html\?project=.+&from=\d{4}-\d\d-\d\d&to=\d{4}-\d\d-\d\d$/.test(period), true);
  await p.click('#pa-filter [data-filter="diff"]');
  check('only differences', await p.$$eval('.pa-bd-row:not(.pa-row-head)', (rows) => rows.filter((r) => !r.hidden).map((r) => r.dataset.item)), ['502-01']);
  const [paFile] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), p.click('#btn-download-payapp-file')]);
  check('Pay App Excel download', /\.xlsx$/.test(paFile.suggestedFilename()), true);
  await p.goto(`${B}/${period}`); await settle();
  check('period link opens Quantities on that range', [await p.getAttribute('[data-range="custom"]', 'aria-pressed'), await p.$$eval('button.qs-row', (rows) => rows.length)], ['true', 5]);
  await p.screenshot({ path: `${OUT}/payapps-desktop.png`, fullPage: true });

  // Log Quantities: running totals, day arrows.
  await p.goto(`${B}/quick-quantity.html?project=${pid}`); await settle();
  const today = await p.inputValue('#f-date');
  // The example reports end yesterday, leaving today open for the tour's
  // new report.
  check('today has no report yet', (await text(p, '#date-context')).startsWith('No report for this day yet.'), true);
  const lastDate = await p.evaluate(async (projectId) => (await getReportsForProject(projectId)).find((r) => String(r.reportNo) === '19').date, pid);
  await p.fill('#f-date', lastDate); await p.dispatchEvent('#f-date', 'change');
  await p.waitForFunction(() => document.querySelector('#date-context').textContent.startsWith('Editing'), null, { timeout: 5000 }).catch(() => {});
  check('editing the last report', await text(p, '#date-context'), "Editing Report #19's quantities.");
  const row = '.qq-row[data-item-number="502-01"]';
  check('asphalt to date', (await text(p, `${row} .qq-progress`)).startsWith('To date 440 of 650 TON · 210 left'), true);
  await p.fill(`${row} .qq-qty`, '400');
  check('running total flags over plan', (await text(p, `${row} .qq-progress`)).startsWith('To date 736 of 650 TON · 86 over plan'), true);
  await p.click('#day-next');
  await p.waitForFunction(() => document.querySelector('#date-context').textContent.startsWith('No report'), null, { timeout: 5000 }).catch(() => {});
  check('next day: new report', (await text(p, '#date-context')).startsWith('No report for this day yet.'), true);
  await p.click('#day-today');
  check('back to today', await p.inputValue('#f-date'), today);

  // Report editor: Pay Items first and open, calculators, remarks, and the
  // printed detail line under each item.
  const rid = await p.evaluate(async (projectId) => {
    const pr = await getProject(projectId);
    pr.payItemCatalog.find((c) => c.itemNumber === '202-01').stations = true;
    pr.payItemCatalog.find((c) => c.itemNumber === '202-01').side = true;
    await saveProject(pr);
    return (await getReportsForProject(projectId)).find((r) => String(r.reportNo) === '19').id;
  }, pid);
  await p.goto(`${B}/report-editor.html?project=${pid}&report=${rid}`); await settle();
  check('Pay Items is the first section, open', await p.evaluate(() => [document.querySelector('#rb-groups .rb-group').id, document.querySelector('#rb-group-payItems').classList.contains('open')]), ['rb-group-payItems', true]);
  check('one line per item', await p.$$eval('.rpi-item', (els) => els.map((e) => e.querySelector('.rpi-num').textContent)), ['502-01']);
  await p.click('#rpi-add'); await p.fill('#rpi-search', 'removal'); await p.keyboard.press('Enter');
  check('needs a quantity', await text(p, '#pay-items-tag'), '2 items · 1 needs a quantity');
  await p.fill('.rpi-open [data-f=startStation]', '12+30'); await p.fill('.rpi-open [data-f=endStation]', '13+00');
  await p.click('.rpi-open [data-side="Lt"]');
  await p.click('.rpi-open [data-calcmenu]');
  await p.fill('.rpi-open [data-c=w]', '12');
  check('area from stations x width', await p.inputValue('.rpi-open [data-f=qty]'), '93.333');
  await p.click('.rpi-open [data-remarks]'); await p.keyboard.type('Saw cut first');
  await p.click('#rpi-add'); await p.fill('#rpi-search', '713'); await p.keyboard.press('Enter');
  await p.click('.rpi-open [data-calcmenu]'); await p.keyboard.type('5');
  check('Lump Sum percent', await p.inputValue('.rpi-open [data-f=qty]'), '1900');
  await p.click('.rpi-open [data-open]');
  check('closed item shows its details', await text(p, '.rpi-item:nth-child(2) .rpi-sum'), 'Sta. 12+30 to 13+00, Lt, 70 × 12 ft. Saw cut first');
  // Printed: the Work Summary box holds the summary, then a pay item table
  // with each item's details on the line under it.
  await p.waitForTimeout(800);
  const box = await p.evaluate(() => {
    const el = document.querySelector('#rb-preview .rr-sbox');
    const rows = [...el.querySelectorAll('table')[0].querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map((c) => c.textContent));
    return { caption: el.querySelector('caption').textContent, rows, det: el.querySelectorAll('tr.rr-det').length };
  });
  check('pay item table under the summary', box.caption.startsWith('Pay Items'), true);
  check('prints details on the line under the item', box.rows.slice(0, 3), [['502-01', 'Asphalt Concrete', '104', 'TON'], ['202-01', 'Removal of Existing Pavement', '93.333', 'SY'], ['', 'Sta. 12+30 to 13+00, Lt, 70 × 12 ft. Saw cut first']]);
  check('every item in the table, nothing moved to the summary', [box.rows[3][0], box.rows[4][1], box.det], ['713-01', '5% complete', 2]);
  check('same item twice: one row with the total, each entry on the line under it', await p.evaluate(() => summaryBoxPayItems([
    { itemNumber: '502-01', description: 'Asphalt Concrete', qty: '250', unit: 'TON', startStation: '10+00', endStation: '12+00', side: 'Lt' },
    { itemNumber: '202-01', description: 'Removal', qty: '5', unit: 'SY' },
    { itemNumber: '502-01', description: 'Asphalt Concrete', qty: '100.5', unit: 'TON', startStation: '15+00', endStation: '16+00' },
  ]).map((r) => [r.itemNumber, r.qty, r.detail])), [['502-01', '350.5', '250 TON: Sta. 10+00 to 12+00, Lt; 100.5 TON: Sta. 15+00 to 16+00'], ['202-01', '5', '']]);
  await p.screenshot({ path: `${OUT}/report-payitems-desktop.png`, fullPage: true });
  await Promise.all([p.waitForURL(/reports\.html/, { timeout: 30000 }), p.click('#btn-save-report')]);
  check('saved with remarks and calculator', await p.evaluate(async (id) => { const r = await getReport(id); const it = r.payItems.find((x) => x.itemNumber === '202-01'); return [it.remarks, it.calc.type, it.calc.w, it.qty]; }, rid), ['Saw cut first', 'area', '12', '93.333']);

  // Units: Project Settings lists units to confirm, the confirmed unit picks
  // the calculators, a LUMP item confirmed as Lump Sum counts in dollars,
  // and the settings survive the project Excel file.
  await p.evaluate(async (projectId) => {
    const pr = await getProject(projectId);
    pr.payItemCatalog.push({ itemNumber: '202-05', description: 'Removal of Structures', unit: 'LUMP', plannedQty: '', unitPrice: '8000' });
    pr.payItemCatalog.push({ itemNumber: '203-01', description: 'Roadway Excavation', unit: 'CU YD', plannedQty: '1500', unitPrice: '18' });
    pr.payItemCatalog.push({ itemNumber: '730-02', description: 'Sign Panel', unit: 'PANEL', plannedQty: '12', unitPrice: '650' });
    const asphalt = pr.payItemCatalog.find((c) => c.itemNumber === '502-01');
    Object.assign(asphalt, { dailyLimit: '100', remarksRequired: true });
    await saveProject(pr);
  }, pid);
  await p.goto(`${B}/project-setup.html?id=${pid}`); await settle();
  await p.click('[data-sec="pay"]');
  check('units to confirm', await text(p, '#psi-confirm-h'), 'Check 3 units');
  check('LUMP warns it will count in dollars', (await text(p, '.psi-confirm')).includes('count as dollars'), true);
  check('a LUMP item is not Lump Sum until confirmed', await p.evaluate(() => payItemKind(project.payItemCatalog.find((c) => c.itemNumber === '202-05'))), '');
  await p.click('#psi-confirm-all');
  check('suggested units confirmed, own unit left', await text(p, '#psi-confirm-h'), 'Check 1 unit');
  check('unit tags', await p.$$eval('.psi-unit', (els) => els.slice(-3).map((e) => e.textContent.trim())), ['LUMP = LS', 'CU YD = CY', 'PANEL ?']);
  await p.selectOption('[data-psi-guess]', 'OTHER'); await p.click('[data-psi-confirm]');
  check('all confirmed', await p.$('#psi-confirm-h'), null);
  const cy = await p.evaluate(() => project.payItemCatalog.findIndex((c) => c.itemNumber === '203-01'));
  await p.click(`[data-psi-open="${cy}"]`);
  check('calculators for CY', await p.$$eval('[data-psi-calc]', (els) => els.map((e) => e.textContent.trim())), ['Length × Width × Depth', 'Truck loads', 'Area × thickness']);
  await p.click('[data-psi-calc="volume"]');
  check('turning one off saves the rest', await p.evaluate((i) => project.payItemCatalog[i].calcs, cy), ['loads', 'thickness']);
  check('LUMP confirmed counts in dollars', await p.evaluate(() => payItemKind(project.payItemCatalog.find((c) => c.itemNumber === '202-05'))), 'LS');
  const roundTrip = await p.evaluate(() => {
    const wb = buildProjectDataWorkbook({ meta: {}, payItemCatalog: project.payItemCatalog, contractors: [], equipmentLabels: [] });
    const back = parsePayItemsSheet(XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' }).Sheets[PAY_ITEMS_SHEET]);
    const pick = (n) => back.find((x) => x.itemNumber === n);
    // An older file (no new columns) keeps the project's settings on re-upload.
    const old = mergePayItemSettings(project.payItemCatalog, [{ itemNumber: '502-01', description: 'Asphalt Concrete', unit: 'TON' }])[0];
    return [pick('202-05').unitKind, pick('202-05').unit, pick('203-01').calcs, pick('730-02').unitKind, pick('502-01').dailyLimit, pick('502-01').remarksRequired, old.dailyLimit, old.remarksRequired];
  });
  check('settings survive the Excel file', roundTrip, ['LS', 'LUMP', ['loads', 'thickness'], 'OTHER', '100', true, '100', true]);
  await p.click('#fsb-save');
  await p.waitForFunction(() => document.querySelector('#fsb-status').textContent === 'Saved.', null, { timeout: 15000 });
  check('saved', await p.evaluate(async (projectId) => (await getProject(projectId)).payItemCatalog.find((c) => c.itemNumber === '203-01').unitKind, pid), 'CY');

  // The editor: the CY item's truck loads, the asphalt daily limit and
  // required remarks.
  await p.goto(`${B}/report-editor.html?project=${pid}&report=${rid}`); await settle();
  await p.click('#rpi-add'); await p.fill('#rpi-search', '203-01'); await p.keyboard.press('Enter');
  await p.click('.rpi-open [data-calcmenu]');
  check('only the allowed calculators', await p.$$eval('.rpi-open [data-calc]', (els) => els.map((e) => e.textContent.trim())), ['Truck loads', 'Area × thickness']);
  await p.click('.rpi-open [data-calc=loads]');
  await p.fill('.rpi-open [data-c=loads]', '12'); await p.fill('.rpi-open [data-c=size]', '14');
  check('truck loads', await p.inputValue('.rpi-open [data-f=qty]'), '168');
  await p.click('.rpi-item:first-child [data-open]');
  check('required remarks show on the item', await p.$eval('.rpi-open [data-f=remarks]', (e) => e.placeholder), 'Required for this item. Prints with it.');
  await p.fill('.rpi-open [data-f=qty]', '150');
  check('daily limit warning', await text(p, '.rpi-open [data-limit]'), "More than this item's daily limit of 100 TON. Double-check the quantity.");
  await p.click('#btn-generate');
  await p.waitForSelector('#rf-warning-overlay:not([hidden])', { timeout: 15000 }).catch(() => {});
  check('remarks required blocks Generate', (await text(p, '#rf-warning-list')).includes('Remarks for pay item 502-01'), true);
  await p.click('#rf-warning-close');
  await p.fill('.rpi-open [data-f=remarks]', 'Tickets 4410 to 4418');
  await p.fill('.rpi-open [data-f=qty]', '104');
  await Promise.all([p.waitForURL(/reports\.html/, { timeout: 30000 }), p.click('#btn-save-report')]);

  // Project Settings: one page, a section at a time.
  await p.goto(`${B}/project.html?id=${pid}`); await settle();
  check('project page links to Settings', await p.getAttribute('#btn-project-settings', 'href'), `project-setup.html?id=${pid}`);
  await p.goto(`${B}/project-setup.html?id=${pid}`); await settle();
  check('settings sections', await p.$$eval('#ps-nav [data-sec]', (els) => els.map((e) => e.dataset.sec)), ['info', 'pay', 'crew', 'checks', 'form', 'look', 'files', 'delete']);
  check('contract end worked out', (await text(p, '#ps-endinfo')).startsWith('Ends '), true);
  await p.click('[data-sec="form"]');
  check('no print preview beside Report Form', await p.isVisible('#ps-right'), false);
  await p.click('.ps-frow:has-text("Activity") [data-v="req"]');
  await p.click('.ps-frow:has-text("Notes") [data-v="hid"]');
  check('report form summary', await text(p, '[data-sec="form"] .psn-s'), '1 required · 1 hidden');
  await p.click('#fsb-save');
  await p.waitForFunction(() => document.querySelector('#fsb-status').textContent === 'Saved.', null, { timeout: 15000 });
  check('report form saved', await p.evaluate(async (id) => { const pr = await getProject(id); return [pr.requiredFields, pr.hiddenFields]; }, pid), [['activity'], ['notes']]);
  await p.click('[data-sec="delete"]');
  check('delete needs the project number typed', await p.isDisabled('#btn-delete-project'), true);
  await p.fill('#ps-del-confirm', 'demo-101');
  check('then it unlocks', await p.isDisabled('#btn-delete-project'), false);
  await p.evaluate(async (id) => { const pr = await getProject(id); pr.requiredFields = []; pr.hiddenFields = []; await saveProject(pr); }, pid);

  // Tests Performed and Checks Completed: checks set up in Project
  // Settings, both marked on a report, both printed under the pay items.
  await p.goto(`${B}/project-setup.html?id=${pid}`); await settle();
  await p.click('[data-sec="checks"]');
  for (const c of ['Slope', 'Erosion Control']) { await p.fill('#ps-new-check', c); await p.keyboard.press('Enter'); }
  check('checks listed', await p.$$eval('[data-chk]', (els) => els.map((e) => e.value)), ['Slope', 'Erosion Control']);
  await p.click('[data-sec="form"]');
  await p.click('.ps-frow:has-text("Checks Completed") [data-v="req"]');
  await p.click('#fsb-save');
  await p.waitForFunction(() => document.querySelector('#fsb-status').textContent === 'Saved.', null, { timeout: 15000 });
  await p.goto(`${B}/report-editor.html?project=${pid}&report=${rid}`); await settle();
  check('editor order: tests and checks right after Work Summary', await p.$$eval('#rb-groups .rb-group', (els) => els.map((e) => e.dataset.group).slice(3, 6)), ['workSummary', 'tests', 'checks']);
  await p.evaluate(() => { setGroupOpen('tests', true); setGroupOpen('checks', true); });
  await p.click('#rtests-add');
  await p.selectOption('#rtests-list select', 'Slump');
  await p.fill('[data-tn="0"]', 'Truck 4417, 3.5 in');
  check('checks needing a mark', await text(p, '#rb-group-checks .rb-group-sum'), '2 of 2 not marked');
  await p.click('[data-ck="Slope"][data-st="done"]');
  await p.fill('[data-cn="Slope"]', '2:1 on Lt embankment');
  await p.click('#btn-generate');
  await p.waitForSelector('#rf-warning-overlay:not([hidden])', { timeout: 15000 }).catch(() => {});
  check('required checks block Generate', (await text(p, '#rf-warning-list')).includes('Checks Completed'), true);
  await p.click('#rf-warning-close');
  await p.click('[data-ck="Erosion Control"][data-st="na"]');
  check('all marked', await text(p, '#rb-group-checks .rb-group-sum'), 'All marked');
  await p.waitForTimeout(800);
  const printedBox = await p.evaluate(() => {
    const el = document.querySelector('#rb-preview .rr-sbox');
    return { captions: [...el.querySelectorAll('caption')].map((c) => c.textContent), tests: [...el.querySelectorAll('table')[1].querySelectorAll('tbody td')].map((c) => c.textContent), checks: [...el.querySelectorAll('table')[2].querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map((c) => c.textContent)), overflow: !!el.dataset.overflow };
  });
  check('printed in order under the summary', printedBox.captions, ['Pay Items (Location and Description of each item required above):', 'Tests Performed:', 'Checks Completed:']);
  check('test printed', printedBox.tests, ['Slump', 'Truck 4417, 3.5 in']);
  check('checks printed', printedBox.checks, [['Slope', 'Done', '2:1 on Lt embankment'], ['Erosion Control', 'N/A', '']]);
  check('fits', [printedBox.overflow, await p.isVisible('#rb-fit-warn')], [false, false]);
  await Promise.all([p.waitForURL(/reports\.html/, { timeout: 30000 }), p.click('#btn-save-report')]);
  const visible = () => p.$$eval('.report-row, .report-card', (els) => els.filter((e) => e.offsetParent).length);
  await p.waitForTimeout(500);
  const all = await visible();
  await p.fill('#f-search', 'slump'); await p.waitForTimeout(500);
  check('search finds just the day a test was done', [all > 1, await visible()], [true, 1]);

  // The tutorial is W.I.P.: no character or hand yet, labeled throughout.
  await p.goto(`${B}/index.html`); await settle();
  check('tutorial pages stamped W.I.P.', await p.evaluate(() => document.body.classList.contains('tutorial-wip') && document.querySelector('.tutorial-banner').textContent.includes('W.I.P.')), true);
  check('no character or hand', [await p.isVisible('.tour-char'), await p.isVisible('.tour-hand')], [false, false]);

  // No Work Day / Weather Day: one tap on the button, one on the reason.
  const nw = await ctx.newPage();
  await nw.addInitScript(() => sessionStorage.setItem('dr-tutorial', '1')); // tutorial mode is per tab
  nw.on('pageerror', (e) => errs.push(e.message));
  nw.on('dialog', (d) => d.accept()); // "Replace the notes?" when switching Weather Day to No Work Day
  await nw.goto(`${B}/report-editor.html?project=${pid}&report=new`); await nw.waitForTimeout(2000);
  await nw.click('#btn-weather-day'); await nw.click('#blank-day-overlay [data-reason="0"]'); await nw.waitForTimeout(800);
  check('Weather Day: marker, no hours, reason in the summary, time comment', await nw.evaluate(() => [report.notes, report.hours, report.workBegin, report.workSummary.startsWith('No work performed due to rain.'), report.commentsOnTime]), ['WEATHER DAY', 0, '', true, 'Weather day (rain). Recommend no time charged.']);
  await nw.click('#btn-no-work-day'); await nw.click('#blank-day-overlay [data-reason="5"]'); await nw.waitForTimeout(500);
  check('No Work Day: reason added ahead of the summary', await nw.evaluate(() => [report.notes, report.workSummary.split('\n')[0]]), ['NO WORK DAY', 'No work performed. Holiday.']);
  await nw.close();

  // Phone width: nothing wider than the screen.
  await p.setViewportSize({ width: 390, height: 844 });
  for (const page of [`quantity-sheet.html?project=${pid}`, `pay-apps.html?project=${pid}`, `quick-quantity.html?project=${pid}`, `project.html?id=${pid}`, `report-editor.html?project=${pid}&report=${rid}`, `project-setup.html?id=${pid}`]) {
    await p.goto(`${B}/${page}`); await settle();
    if (page.startsWith('quantity-sheet')) { await p.click('[data-range="all"]'); await p.click('button.qs-row[data-item="502-01"]'); }
    check(`phone fits: ${page.split('?')[0]}`, await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  }
  await p.screenshot({ path: `${OUT}/quantities-phone.png`, fullPage: true });

  check('page errors', errs, []);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
})();
