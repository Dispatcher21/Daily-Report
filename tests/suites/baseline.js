// The basics: the site talks to the emulators, and a second device that
// joins with the company password sees the first device's project.
const { launchBrowser, emulatorContext, clearEmulators } = require('../harness');
const B = 'http://127.0.0.1:8126';
let fails = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (wanted ${JSON.stringify(want)})`}`); };
(async () => {
  await clearEmulators();
  const browser = await launchBrowser();
  const a = await (await emulatorContext(browser)).newPage();
  const errs = []; a.on('pageerror', (e) => errs.push('A ' + e.message));
  await a.goto(`${B}/settings.html`); await a.waitForTimeout(1200);
  check('test project in use', await a.evaluate(async () => { await waitForFirebaseCore(); return window.FirebaseCore.projectId; }), 'daily-reports-test');
  await a.evaluate(async () => {
    await saveUserName('Alice');
    await createCompanyRoom({ name: 'Emu Co', password: 'emu-company-pw', adminPassword: 'emu-admin-pw' });
    const p = { id: crypto.randomUUID(), name: 'EMU-1 Test Project', companyCode: (await getCompanyRoom()).code, payItemCatalog: [], createdAt: Date.now() };
    await saveProject(p);
  });
  await a.waitForTimeout(1500);
  const b = await (await emulatorContext(browser)).newPage();
  b.on('pageerror', (e) => errs.push('B ' + e.message));
  await b.goto(`${B}/settings.html`); await b.waitForTimeout(1200);
  const got = await b.evaluate(async () => { await saveUserName('Bob'); await createAccount({ name: 'Bob', email: 'bob@example.com', password: 'bobpass12' }); await joinCompanyRoom('emu-company-pw'); return (await getAllProjects()).map((p) => p.name); });
  check('device B sees the project', got, ['EMU-1 Test Project']);
  check('page errors', errs, []);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
})();
