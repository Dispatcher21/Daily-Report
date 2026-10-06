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
  const pid = await p.evaluate(async () => (await getAllProjects())[0].id);
  const settle = () => p.waitForTimeout(1500);

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
  check('editing today\'s report', await text(p, '#date-context'), "Editing Report #19's quantities.");
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
  const printed = await p.evaluate(() => { const v = buildSheet1Values(report); return { rows: [28, 29, 30, 31, 32].map((r) => [v['I' + r] || '', v['K' + r] || '', v['P' + r] || '']), small: [...v.smallCells], summary: v[RR_WORK_SUMMARY_CELL].includes('713-01') }; });
  check('prints details on the line under the item', printed.rows.slice(0, 3), [['502-01', 'Asphalt Concrete', '104'], ['202-01', 'Removal of Existing Pavement', '93.333'], ['', 'Sta. 12+30 to 13+00, Lt, 70 × 12 ft. Saw cut first', '']]);
  check('then the next item, details smaller', [printed.rows[3][0], printed.rows[4][1], printed.small], ['713-01', '5% complete', ['K30', 'K32']]);
  await p.screenshot({ path: `${OUT}/report-payitems-desktop.png`, fullPage: true });
  await Promise.all([p.waitForURL(/reports\.html/, { timeout: 30000 }), p.click('#btn-save-report')]);
  check('saved with remarks and calculator', await p.evaluate(async (id) => { const r = await getReport(id); const it = r.payItems.find((x) => x.itemNumber === '202-01'); return [it.remarks, it.calc.type, it.calc.w, it.qty]; }, rid), ['Saw cut first', 'area', '12', '93.333']);

  // Phone width: nothing wider than the screen.
  await p.setViewportSize({ width: 390, height: 844 });
  for (const page of [`quantity-sheet.html?project=${pid}`, `pay-apps.html?project=${pid}`, `quick-quantity.html?project=${pid}`, `project.html?id=${pid}`, `report-editor.html?project=${pid}&report=${rid}`]) {
    await p.goto(`${B}/${page}`); await settle();
    if (page.startsWith('quantity-sheet')) { await p.click('[data-range="all"]'); await p.click('button.qs-row[data-item="502-01"]'); }
    check(`phone fits: ${page.split('?')[0]}`, await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
  }
  await p.screenshot({ path: `${OUT}/quantities-phone.png`, fullPage: true });

  check('page errors', errs, []);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
})();
