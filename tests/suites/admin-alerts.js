const { OUT, launchBrowser, emulatorContext, clearEmulators } = require('../harness');
const B = 'http://127.0.0.1:8126';
let fails = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (wanted ${JSON.stringify(want)})`}`); };
const outbox = async (to) => {
  const r = await (await fetch('http://127.0.0.1:8080/v1/projects/daily-reports-test/databases/(default)/documents/devOutbox?pageSize=300', { headers: { Authorization: 'Bearer owner' } })).json();
  return (r.documents || []).map((d) => ({ to: d.fields.to.stringValue, subject: d.fields.subject.stringValue, text: d.fields.text.stringValue, html: d.fields.html.stringValue, at: Number(d.fields.at.integerValue) })).filter((m) => m.to === to).sort((a, b) => a.at - b.at);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await clearEmulators();
  const browser = await launchBrowser();
  const errs = [];
  const device = async (n) => { const p = await (await emulatorContext(browser)).newPage(); p.on('pageerror', (e) => errs.push(`${n}: ${e.message}`)); p.on('dialog', (d) => { errs.push(`${n} dialog: ${d.message()}`); d.accept(); }); await p.goto(`${B}/settings.html`); await p.waitForTimeout(1000); return p; };
  const A = await device('A'), Bp = await device('B');
  await A.evaluate(async () => {
    await saveUserName('Ada'); await createAccount({ name: 'Ada', email: 'ada@example.com', password: 'adapass12' });
    await createCompanyRoom({ name: 'Alert Co', password: 'alert-pw-1', adminPassword: 'alert-admin-1' });
    const code = (await getCompanyRoom()).code;
    await saveProject({ id: 'p1', name: 'Highway 12', companyCode: code, payItemCatalog: [], meta: {}, createdAt: Date.now() });
    await saveProject({ id: 'p2', name: 'Bridge 4', companyCode: code, payItemCatalog: [], meta: {}, createdAt: Date.now() });
    await pushAllLocalData(code);
  });
  const bUid = await Bp.evaluate(async () => { await saveUserName('Bob'); await createAccount({ name: 'Bob', email: 'bob@example.com', password: 'bobpass12' }); await joinCompanyRoom('alert-pw-1'); return window.FirebaseCore.auth.currentUser.uid; });
  const run = () => A.evaluate(() => window.FirebaseCore.callFunction('devRunAdminAlerts', {}));
  await wait(3000); await run();
  check('nothing to report yet (creator is not an alert)', (await outbox('ada@example.com')).length, 0);

  await A.evaluate(async (uid) => {
    await setRequireApproval(true);
    await updateTeamMember(uid, { role: 'admin' });
    await updateTeamMember(uid, { status: 'disabled' });
    const r = await makeBlankReport(1, await getProject('p1'), null); r.date = '2026-10-01'; await saveReport(r); await confirmReportSyncStatus(await getReport(r.id));
    await deleteReport(r.id);
    await deleteProject('p2');
    await reportSyncProblem('Daily report #7 (2026-10-02)', { code: 'permission-denied', message: 'Missing or insufficient permissions.' });
  }, bUid);
  await wait(9000); await run();
  let mail = await outbox('ada@example.com');
  const m = mail.pop();
  const has = (s) => !!m && m.text.includes(s);
  check('one email, both sections', [mail.length, m && m.subject], [0, 'Security changes and problems at Alert Co']);
  check('no false admin-password alarm', has('admin password'), false);
  check('approval switch', has('Approving new members was turned on.'), true);
  check('new admin, by whom', has('Bob (bob@example.com) is now an admin, made one by Ada.'), true);
  check('access turned off', has('Bob (bob@example.com) had their access turned off by Ada.'), true);
  check('report deleted', has('Ada deleted daily report #1 for Highway 12 (2026-10-01)'), true);
  check('project deleted', has('Ada deleted the project "Bridge 4".'), true);
  check('problem from a device', has("Ada's device: Daily report #7 (2026-10-02) couldn't upload: the server refused it"), true);
  check('no links', !!m && !/https?:|href=|<a\s/i.test(m.text + m.html), true);
  check('problems are write-only', await A.evaluate(async () => { const { collection, getDocs } = await import(FIRESTORE_SDK); return getDocs(collection(window.FirebaseCore.db, 'companies', (await getCompanyRoom()).code, 'problems')).then(() => 'READABLE', (e) => e.code); }), 'permission-denied');
  check('disabled admin got nothing', (await outbox('bob@example.com')).filter((x) => /Security|Problems/.test(x.subject)).length, 0);

  // A second problem the same day waits (once a day); security still goes out.
  await A.evaluate(async () => { await saveSetting('lastProblemReportAt', 0); await reportSyncProblem('Daily report #8', { code: 'permission-denied' }); await setRequireApproval(false); });
  await wait(9000); await run();
  const m2 = (await outbox('ada@example.com')).pop();
  check('later run: security only, problem held for tomorrow', m2 && [m2.subject, m2.text.includes('#8')], ['Security alert at Alert Co', false]);

  // Settings: admin switches; turning security off stops them.
  await A.goto(`${B}/settings.html`); await A.waitForTimeout(2500);
  check('admin switches shown, defaults', [await A.isVisible('#account-security-alerts'), await A.isChecked('#account-security-alerts'), await A.isChecked('#account-problem-alerts'), await A.isChecked('#account-roundup-all')], [true, true, true, false]);
  await A.click('#account-security-alerts'); await A.waitForTimeout(1500);
  const before = (await outbox('ada@example.com')).length;
  await A.evaluate(() => setRequireApproval(true)); await wait(4000); await run();
  check('security off: no email', (await outbox('ada@example.com')).length, before);

  // Company-wide roundup (no managed projects needed).
  await A.click('#account-roundup-all'); await A.waitForTimeout(1500);
  await A.click('#btn-account-roundup-preview'); await A.waitForTimeout(5000);
  const r = (await outbox('ada@example.com')).pop();
  check('company-wide roundup', !!r && r.subject.startsWith('Weekly Roundup') && r.text.includes('Highway 12') && r.text.includes('1 company project'), true);
  await A.screenshot({ path: `${OUT}/admin-email-settings.png`, fullPage: true });
  check('page errors', errs, []);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
})();
