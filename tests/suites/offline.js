// Working with no signal: the installed app opens offline (pages with
// ?project=... in the address included), the Firebase SDK is saved for
// offline use, the sign-in page doesn't hang when Firebase can't load, and
// a report saved offline uploads by itself once the connection is back.
// Uses localhost rather than 127.0.0.1: the service worker only runs on
// https or localhost (see common.js).
const { launchBrowser, emulatorContext, clearEmulators, PROJECT, OUT } = require('../harness');
const B = 'http://localhost:8126';
let fails = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (wanted ${JSON.stringify(want)})`}`); };

// Opens a page and waits until the service worker controls it, so
// everything is saved and the next load can come from the saved copy.
async function install(page, path) {
  await page.goto(`${B}/${path}`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

// Playwright's offline switch doesn't reach the service worker's own
// requests, so the Firebase emulators are cut off as well. Only those:
// routing every request makes the browser skip the service worker for
// some of them, which a real device never does.
const EMULATORS = /^http:\/\/127\.0\.0\.1:(8080|9099|9199|5001)\//;
const cutOff = (r) => r.abort('internetdisconnected');
async function goOffline(ctx) { await ctx.setOffline(true); await ctx.route(EMULATORS, cutOff); }
async function goOnline(ctx) { await ctx.unroute(EMULATORS, cutOff); await ctx.setOffline(false); }

async function cloudReport(code, id) {
  const res = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/companies/${code}/reports/${id}`, { headers: { Authorization: 'Bearer owner' } });
  return res.ok;
}

(async () => {
  await clearEmulators();
  const browser = await launchBrowser();
  const errs = [];

  // ---------- an inspector's iPad: in a company, signal comes and goes ----------
  const ctx = await emulatorContext(browser);
  const a = await ctx.newPage();

  a.on('pageerror', (e) => errs.push('A ' + e.message));
  await install(a, 'settings.html');
  const { code, projectId } = await a.evaluate(async () => {
    await saveUserName('Alice');
    await createCompanyRoom({ name: 'Offline Co', password: 'offline-company-pw', adminPassword: 'offline-admin-pw' });
    const code = (await getCompanyRoom()).code;
    const p = { id: crypto.randomUUID(), name: 'OFF-1 Field Project', companyCode: code, meta: { projectNo: 'OFF-1', projectName: 'Field Project' }, payItemCatalog: [], createdAt: Date.now() };
    await saveProject(p);
    return { code, projectId: p.id };
  });
  check('Firebase SDK saved for offline use', await a.evaluate(async () => {
    const cache = await caches.open((await caches.keys())[0]);
    return (await cache.keys()).filter((r) => r.url.startsWith('https://www.gstatic.com/')).length;
  }), 5);

  await goOffline(ctx);
  check('offline', await a.evaluate(() => navigator.onLine), false);
  await a.goto(`${B}/reports.html?project=${projectId}`);
  check('reports page opens offline', (await a.title()).startsWith('View Reports'), true);
  await a.goto(`${B}/report-editor.html?project=${projectId}&report=new`);
  check('report form opens offline', new URL(a.url()).pathname, '/report-editor.html');
  const offlineBar = () => a.evaluate(() => { const el = document.getElementById('offline-banner'); return el && !el.hidden ? el.textContent : null; });
  await a.waitForFunction(() => { const el = document.getElementById('offline-banner'); return el && el.textContent; });
  check('offline bar shows', await offlineBar(), "You're offline. Reports save on this device and upload when you're back online.");
  check('report form has the project', await a.evaluate(async (id) => (await getProject(id)).name, projectId), 'OFF-1 Field Project');
  check('Firebase loads offline from the saved copy', await a.evaluate(() => waitForFirebaseCore().then((core) => !!core.auth)), true);

  const reportId = await a.evaluate(async (projectId) => {
    const r = { id: crypto.randomUUID(), projectId, companyCode: (await getCompanyRoom()).code, reportNo: 1, date: '2026-10-07', photos: [], createdAt: Date.now() };
    await saveReport(r);
    return r.id;
  }, projectId);
  await a.waitForTimeout(1500);
  check('offline report waits to upload', await a.evaluate(async (id) => !!(await getReport(id)).pendingPush, reportId), true);
  check('not in the cloud yet', await cloudReport(code, reportId), false);
  check('offline bar counts it', await offlineBar(), "You're offline. 1 report waiting to upload when you're back online.");

  // Closing the app before the upload gave up still leaves it queued.
  await a.goto(`${B}/index.html`);
  // Long enough for Firebase to decide it's offline and fail any read the
  // home page makes (about 10 seconds), so one that isn't handled shows up
  // in the page errors check at the end (the Manager Dashboard used to).
  await a.waitForTimeout(12000);
  check('still queued after leaving the page', await a.evaluate(async (id) => !!(await getReport(id)).pendingPush, reportId), true);
  await a.screenshot({ path: `${OUT}/offline-bar.png` });

  await goOnline(ctx);
  let landed = false;
  for (let i = 0; i < 30 && !landed; i++) { await a.waitForTimeout(1000); landed = await cloudReport(code, reportId); }
  check('uploads by itself when the signal comes back', landed, true);
  await a.waitForTimeout(1000);
  check('offline bar gone', await offlineBar(), null);
  check('no longer queued', await a.evaluate(async (id) => !!(await getReport(id)).pendingPush, reportId), false);

  // ---------- no saved Firebase SDK: the sign-in page still moves on ----------
  const ctx2 = await emulatorContext(browser);
  const b = await ctx2.newPage();
  b.on('pageerror', (e) => errs.push('B ' + e.message));
  await install(b, 'login.html');
  await b.evaluate(async () => {
    await saveUserName('Bob');
    const cache = await caches.open((await caches.keys())[0]);
    for (const r of await cache.keys()) if (r.url.startsWith('https://www.gstatic.com/')) await cache.delete(r);
  });
  await goOffline(ctx2);
  await ctx2.route('https://www.gstatic.com/**', cutOff);
  await b.goto(`${B}/login.html`);
  await b.waitForURL(/index\.html/, { timeout: 15000 }).catch(() => {});
  check('sign-in page goes on to home offline', new URL(b.url()).pathname, '/index.html');
  check('Firebase gives up offline instead of hanging', await b.evaluate(() => Promise.race([
    waitForFirebaseCore().then(() => 'loaded', () => 'gave up'),
    new Promise((resolve) => setTimeout(() => resolve('hung'), 8000)),
  ])), 'gave up');

  check('page errors', errs, []);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
})();
