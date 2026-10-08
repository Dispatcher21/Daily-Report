// The home, project and Manager pages after the overhaul: dashboards made of
// widgets (add, remove, resize, saved per person), organizing projects
// without dragging (menus, Organize, folders opened in place), the New
// Report picker, the inspector's view, the review inbox, and approved
// reports and Pay Apps staying locked.
const { launchBrowser, emulatorContext, clearEmulators, OUT } = require('../harness');
const B = 'http://127.0.0.1:8126';
let fails = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ' (expected ' + JSON.stringify(want) + ')'}`);
};
const settle = (p, ms = 1200) => p.waitForTimeout(ms);
// Anything marked hidden that a CSS display rule still shows.
const shownHidden = (p) => p.evaluate(() => [...document.querySelectorAll('[hidden]')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.id || e.className));

// A company with a handful of real-looking projects, ~6 weeks of reports,
// Pay Apps and a mix of approval states.
async function seed(p) {
  return p.evaluate(async () => {
    await saveUserName('Alice');
    await createCompanyRoom({ name: 'Overhaul Co', password: 'overhaul-pw-1', adminPassword: 'overhaul-admin-1' });
    const code = (await getCompanyRoom()).code;
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
    const catalog = [
      { itemNumber: '203-01', description: 'Excavation', unit: 'CY', plannedQty: 4800, unitPrice: 28 },
      { itemNumber: '701-01', description: 'Class A Concrete', unit: 'CY', plannedQty: 640, unitPrice: 1150 },
      { itemNumber: '706-01', description: 'Reinforcing Steel', unit: 'LB', plannedQty: 98000, unitPrice: 1.85 },
      { itemNumber: '727-01', description: 'Mobilization', unit: 'LS', plannedQty: 1, unitPrice: 260000 },
    ];
    const projects = [
      ['p-wood', 'Woodlake Pump Station', '\u{1F4A7}', 120, 420],
      ['p-us90', 'US 90 Overlay', '\u{1F6E3}️', 200, 300],
      ['p-teche', 'Bayou Teche Bridge Rehab', '\u{1F3D7}️', 330, 400],
      ['p-la14', 'LA 14 Drainage', '\u{1F30A}', 150, 240],
      ['p-i10', 'I-10 Lighting', '\u{1F4A1}', 90, 150],
    ];
    for (const [id, name, icon, ntpAgo, length] of projects) {
      await saveProject({ id, name, icon, companyCode: code, payItemCatalog: catalog, createdAt: Date.now(),
        meta: { projectNo: 'H.' + id.slice(2).toUpperCase(), projectName: name + ' project', ntpDate: daysAgo(ntpAgo), contractLength: String(length), peName: 'R. Landry' } });
    }
    let n = 0;
    for (const [id, , , ntpAgo] of projects) {
      const project = await getProject(id);
      let prev = null;
      for (let d = 40; d >= 1; d--) {
        const date = daysAgo(d);
        const dow = new Date(date + 'T12:00:00').getDay();
        if (dow === 0 || dow === 6) continue;
        if (id === 'p-teche' && d < 6) continue; // a quiet project
        const r = await makeBlankReport(++n, project, prev);
        r.id = `r-${id}-${d}`;
        r.date = date;
        r.activity = d % 3 ? 'Placed concrete' : 'Tied rebar';
        r.weatherDesc = d % 7 === 0 ? 'Thunderstorms' : 'Sunny';
        r.inspectors = [{ name: 'Alice', hours: 9, timeEntries: [{ start: '07:00', end: '16:00' }] }];
        r.payItems = [{ itemNumber: '203-01', qty: 40 + (ntpAgo % 7) }, { itemNumber: '706-01', qty: 900 }];
        r.approvalStatus = d > 10 ? 'approved' : 'pending';
        await saveReport(r);
        prev = r;
      }
    }
    const wood = await getProject('p-wood');
    wood.billingEstimates = [
      { id: 'pa-1', estimateNo: '1', date: daysAgo(35), itemTotals: { '203-01': 600, '727-01': 52000 }, approvalStatus: 'approved' },
      { id: 'pa-2', estimateNo: '2', date: daysAgo(5), itemTotals: { '203-01': 1300, '727-01': 104000 } },
    ];
    await saveProject(wood);
    await saveManagedProjectIds(['p-wood', 'p-us90', 'p-la14']);
    return code;
  });
}

(async () => {
  await clearEmulators();
  const browser = await launchBrowser();
  const errs = [];
  const ctx = await emulatorContext(browser, { viewport: { width: 1500, height: 1000 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => { errs.push(`desktop: ${e.message}`); console.log('PAGE ERROR', p.url(), e.stack); });
  p.on('dialog', (d) => d.accept());
  await p.goto(`${B}/settings.html`); await settle(p);
  await seed(p);
  await p.evaluate(async () => { for (const r of await getAllReports()) await confirmReportPushed(r).catch(() => {}); });

  // ---------- Home page ----------
  await p.goto(`${B}/index.html`); await settle(p, 2500);
  await p.screenshot({ path: `${OUT}/home-desktop.png`, fullPage: true });
  check('home: hidden things stay hidden', await shownHidden(p), []);
  check('home: dashboard on the left, projects on the right', await p.evaluate(() => {
    const d = $('#manager-dashboard-col').getBoundingClientRect(), pr = $('#proj-col').getBoundingClientRect();
    return [!$('#manager-dashboard-col').hidden, d.left < pr.left];
  }), [true, true]);
  check('home: default widgets', await p.$$eval('#md-widgets .widget', (els) => els.map((e) => e.dataset.type)), ['attention', 'overview', 'calendar', 'trend', 'hours', 'feed']);
  check('home: attention lists reports waiting for approval', (await p.textContent('#md-widgets [data-type="attention"]')).includes('waiting for your approval'), true);
  check('home: quiet project flagged', (await p.textContent('#md-widgets [data-type="attention"]')).includes('No report from Bayou Teche'), true);
  check('home: pace chart has a line per project and Pay App stars', await p.evaluate(() => [$$('#md-widgets [data-type="trend"] polyline').length, $$('#md-widgets [data-type="trend"] .trend-star').length > 0]), [5, true]);
  check('home: cards show the last report date', await p.$$eval('#hub-grid .hc-last', (els) => els.length), 5);

  // Edit Dashboard: remove, undo, add, resize, and it stays after reload.
  await p.click('#md-edit-btn');
  await p.click('#md-widgets [data-type="hours"] [data-w="remove"]');
  check('remove a widget', await p.$$eval('#md-widgets .widget', (els) => els.some((e) => e.dataset.type === 'hours')), false);
  await p.click('#app-toast button');
  check('undo brings it back', await p.$$eval('#md-widgets .widget', (els) => els.some((e) => e.dataset.type === 'hours')), true);
  await p.click('#md-add-btn');
  await p.click('[data-add="deadlines"]');
  await p.click('#md-widgets [data-type="calendar"] [data-w="size"]');
  await p.click('#md-done-btn');
  await p.reload(); await settle(p, 2500);
  check('widget changes are kept', await p.evaluate(() => [$$('#md-widgets .widget').map((e) => e.dataset.type).includes('deadlines'), $('#md-widgets [data-type="calendar"]').classList.contains('w-full')]), [true, true]);

  // Make your own widget.
  await p.click('#md-edit-btn');
  await p.click('#md-add-btn');
  await p.click('[data-add="custom"]');
  await p.fill('#wb-title', 'Hours This Month');
  await p.selectOption('#wb-measure', 'hours');
  await p.selectOption('#wb-range', 'month');
  await p.selectOption('#wb-show', 'total');
  await p.click('#wb-save');
  await p.click('#md-done-btn');
  check('custom widget added', await p.evaluate(() => { const w = $('#md-widgets [data-type="custom"]'); return w ? [w.querySelector('h2').textContent, /h$/.test(w.querySelector('.dc-value').textContent.trim())] : null; }), ['Hours This Month', true]);

  // New Report asks which project.
  await p.click('#hdr-new');
  await p.waitForSelector('#app-sheet .sheet-item');
  check('New Report lists the projects', await p.$$eval('#app-sheet .sheet-item', (els) => els.length), 5);
  check('New Report starts a report on the picked project', await p.getAttribute('#app-sheet .sheet-item', 'href').then((h) => /report-editor\.html\?project=.+&report=new/.test(h)), true);
  await p.keyboard.press('Escape');

  // Organize: new folder from picked cards, open it in place, take one out.
  await p.click('#btn-organize');
  for (const i of [0, 1, 2]) { await p.locator('#hub-grid .hub-card[data-drag-type="project"]').nth(i).click(); await settle(p, 300); }
  check('picked cards show it', await p.$$eval('#hub-grid .org-picked', (els) => els.length), 3);
  await p.click('#org-new');
  await p.fill('#fe-name', 'District 3');
  await p.click('#fe-save'); await settle(p);
  check('folder made from picked projects', await p.evaluate(() => { const f = $('#hub-grid .folder-card'); return f ? [f.querySelector('.hc-title').textContent, f.querySelector('.hc-desc').textContent] : null; }), ['District 3', '3 projects']);
  await p.click('#hub-grid .folder-card'); await settle(p, 600);
  check('folder opens in place', await p.evaluate(() => [$('#proj-eyebrow b').textContent, $$('#hub-grid .hub-card[data-drag-type="project"]').length]), ['District 3', 3]);
  await p.click('#hub-grid .hub-card [data-menu-id]');
  await p.click('#app-sheet [data-m="out"]'); await settle(p, 600);
  check('take a project out from its menu', await p.$$eval('#hub-grid .hub-card[data-drag-type="project"]', (els) => els.length), 2);
  await p.click('#crumb-back'); await settle(p, 600);
  check('back to every project', await p.evaluate(() => [$$('#hub-grid .folder-card').length, $$('#hub-grid .hub-card[data-drag-type="project"]').length]), [1, 3]);
  check('layout saved with the folder', await p.evaluate(async () => (await getProjectLayout()).filter((e) => e.type === 'folder').map((f) => f.projectIds.length)), [2]);

  // ---------- Project page ----------
  await p.goto(`${B}/project.html?id=p-wood`); await settle(p, 2500);
  await p.screenshot({ path: `${OUT}/project-desktop.png`, fullPage: true });
  check('project: hidden things stay hidden', await shownHidden(p), []);
  check('project: hero and Workspace', await p.evaluate(() => [$('#hero h2').textContent, $$('.ws-col .action-tiles .hub-card').length, !!$('#project-info dt')]), ['Woodlake Pump Station', 4, true]);
  check('project: default widgets for an admin', await p.$$eval('#pd-widgets .widget', (els) => els.map((e) => e.dataset.type)), ['attention', 'progress', 'dailylog', 'payitems', 'trend', 'payapps']);
  check('project: Pay App waiting shows', (await p.textContent('#pd-widgets [data-type="attention"]')).includes('Pay App #2 waiting'), true);
  check('project: trend has an on-pace line and stars', await p.evaluate(() => [!!$('#pd-widgets [data-type="trend"] .pace-line'), $$('#pd-widgets [data-type="trend"] .trend-star').length]), [true, 2]);
  await p.click('#pd-widgets [data-type="dailylog"] .wcal-clickable[data-report-id]');
  check('project: a calendar day opens its detail', await p.isVisible('#day-detail-overlay'), true);
  await p.click('#ddm-close');

  // ---------- Manager page: review inbox ----------
  const pendingCount = () => p.evaluate(async () => (await getAllReports()).filter((r) => ['p-wood', 'p-us90', 'p-la14'].includes(r.projectId) && (r.approvalStatus || 'pending') === 'pending').length);
  const pending0 = await pendingCount();
  await p.goto(`${B}/manager.html`); await settle(p, 2500);
  await p.screenshot({ path: `${OUT}/manager-desktop.png`, fullPage: true });
  check('manager: hidden things stay hidden', await shownHidden(p), []);
  check('manager: inbox lists every waiting report and Pay App of managed projects', await p.$$eval('#mgr-queue .q-row', (els) => els.length), pending0 + 1);
  await p.click('[data-filter="payapp"]');
  check('manager: Pay App filter', await p.$$eval('#mgr-queue .q-row', (els) => els.map((e) => e.querySelector('.q-name').textContent.trim())), ['\u{1F4A7} Woodlake Pump Station']);
  await p.click('[data-filter="all"]');
  await p.locator('#mgr-queue .q-row').first().click(); await settle(p, 400);
  const firstKey = await p.getAttribute('#mgr-queue .q-row[aria-current="true"]', 'data-q');
  await p.click('#mgr-preview [data-act="approve"]'); await settle(p);
  check('manager: Approve from the preview, then the next item opens', await p.evaluate((k) => { const cur = $('#mgr-queue .q-row[aria-current="true"]'); return [!!cur, cur && cur.dataset.q !== k]; }, firstKey), [true, true]);
  check('manager: approved report is saved', await pendingCount(), pending0 - 1);
  await p.click('#q-pick');
  await p.click('#q-all');
  const picked = await p.$$eval('#mgr-queue .q-row.picked', (els) => els.length);
  check('manager: Pick all unflagged picks the pending reports', picked, pending0 - 1);
  await p.click('#q-approve');
  await p.click('#q-yes'); await settle(p, 2000);
  check('manager: bulk approve', await pendingCount(), 0);

  // ---------- Locks ----------
  const lockedId = await p.evaluate(async () => (await getAllReports()).find((r) => r.projectId === 'p-wood' && r.id !== 'r-p-wood-1' && r.approvalStatus === 'approved').id);
  await p.goto(`${B}/report-editor.html?project=p-wood&report=${lockedId}`); await settle(p, 2500);
  check('locked: the editor says so', await p.isVisible('#locked-banner'), true);
  check('locked: saving is refused', await p.evaluate(async (id) => { const r = await getReport(id); r.activity = 'changed'; return saveReport(r).then(() => 'saved', (e) => e.name); }, lockedId), 'LockedRecordError');
  await p.evaluate((id) => requestReportUnlock(id, 'wrong quantity'), lockedId);
  await p.goto(`${B}/manager.html`); await settle(p, 2000);
  await p.click('[data-filter="all"]');
  check('manager: unlock request shows in the inbox', await p.$$eval('#mgr-queue .q-row', (els) => els.some((e) => /asked to unlock/.test(e.textContent))), true);
  await p.evaluate((id) => unlockReport(id, 'fix quantity'), lockedId);
  await p.goto(`${B}/report-editor.html?project=p-wood&report=${lockedId}`); await settle(p, 2500);
  check('unlocked: the editor opens for edits', await p.isVisible('#locked-banner'), false);
  check('editor: hidden things stay hidden', await shownHidden(p), []);
  check('unlocked: saving sends it back for approval', await p.evaluate(async (id) => { const r = await getReport(id); r.activity = 'fixed'; await saveReport(r); const s = await getReport(id); return [s.approvalStatus, !!s.resubmittedAt]; }, lockedId), ['pending', true]);
  await p.goto(`${B}/report-viewer.html?project=p-wood&report=${lockedId}`); await settle(p, 2500);
  check('viewer: hidden things stay hidden', await shownHidden(p), []);
  await p.goto(`${B}/pay-apps.html?project=p-wood&estimate=pa-1`); await settle(p, 2500);
  check('Pay Apps: an approved one says it is locked', await p.isVisible('#pa-locked'), true);
  check('Pay Apps page: hidden things stay hidden', await shownHidden(p), []);
  check('Pay Apps: an approved Pay App in the company copy wins over a stale edit', await p.evaluate(() => {
    const remote = [{ id: 'pa-1', estimateNo: '1', itemTotals: { a: 1 }, approvalStatus: 'approved', updatedAt: 100 }];
    const stale = protectApprovedPayApps([{ id: 'pa-1', estimateNo: '1', itemTotals: { a: 9 }, approvalStatus: 'approved' }], remote);
    const unlocked = protectApprovedPayApps([{ id: 'pa-1', estimateNo: '1', itemTotals: { a: 9 }, approvalStatus: 'unlocked', unlockedAt: 200 }], remote);
    return [stale.list[0].itemTotals.a, stale.replaced.length, unlocked.list[0].itemTotals.a];
  }), [1, 1, 9]);

  // ---------- Phones ----------
  await p.setViewportSize({ width: 390, height: 844 });
  const phone = p;
  await phone.goto(`${B}/index.html`); await settle(phone, 2500);
  await phone.screenshot({ path: `${OUT}/home-phone.png` });
  check('phone: no sideways scroll on home', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await phone.goto(`${B}/project.html?id=p-wood`); await settle(phone, 2500);
  await phone.screenshot({ path: `${OUT}/project-phone.png` });
  check('phone: no sideways scroll on project', await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  check('no page errors', errs, []);
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL crashed: ' + e.message); process.exit(1); });
