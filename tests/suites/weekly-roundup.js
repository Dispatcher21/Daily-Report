const { OUT, launchBrowser, emulatorContext, clearEmulators } = require('../harness');
const roundup = require('../../functions/roundup.js');
const B = 'http://127.0.0.1:8126';
let fails = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (wanted ${JSON.stringify(want)})`}`); };
const outbox = async (to) => {
  const r = await (await fetch('http://127.0.0.1:8080/v1/projects/daily-reports-test/databases/(default)/documents/devOutbox?pageSize=300', { headers: { Authorization: 'Bearer owner' } })).json();
  return (r.documents || []).map((d) => ({ to: d.fields.to.stringValue, subject: d.fields.subject.stringValue, text: d.fields.text.stringValue, html: d.fields.html.stringValue, at: Number(d.fields.at.integerValue) })).filter((m) => m.to === to).sort((a, b) => a.at - b.at);
};
(async () => {
  // Week math and time zones (no emulator needed).
  check('Tue Oct 6 -> last week Mon-Sun', roundup.lastWeek('2026-10-06', 'Tue'), { start: '2026-09-28', end: '2026-10-04' });
  check('Sun -> week before', roundup.lastWeek('2026-10-04', 'Sun'), { start: '2026-09-21', end: '2026-09-27' });
  const t = new Date('2026-10-06T11:30:00Z');
  check('11:30 UTC is 6:30 Tue in Chicago', roundup.localParts(t, 'America/Chicago'), { iso: '2026-10-06', weekday: 'Tue', hour: 6 });
  check('...and 4:30 in Los Angeles', roundup.localParts(t, 'America/Los_Angeles').hour, 4);
  check('LA gets it at 13:30 UTC', roundup.localParts(new Date('2026-10-06T13:30:00Z'), 'America/Los_Angeles'), { iso: '2026-10-06', weekday: 'Tue', hour: 6 });

  await clearEmulators();
  const browser = await launchBrowser();
  const errs = [];
  const device = async (n) => { const p = await (await emulatorContext(browser)).newPage(); p.on('pageerror', (e) => errs.push(`${n}: ${e.message}`)); p.on('dialog', (d) => { errs.push(`${n} dialog: ${d.message()}`); d.accept(); }); await p.goto(`${B}/settings.html`); await p.waitForTimeout(1000); return p; };
  const A = await device('A'), Bp = await device('B');
  await A.evaluate(async () => {
    await saveUserName('Ada'); await createAccount({ name: 'Ada', email: 'ada@example.com', password: 'adapass12' });
    await createCompanyRoom({ name: 'Roundup Co', password: 'roundup-pw-1', adminPassword: 'roundup-admin-1' });
    const code = (await getCompanyRoom()).code;
    await saveProject({ id: 'p1', name: 'Highway 12', companyCode: code, contractTimeMode: 'working', payItemCatalog: [{ itemNumber: '201', description: 'Clearing', unit: 'AC', plannedQty: 10, unitPrice: 1000 }], meta: { projectNo: 'H12', ntpDate: '2026-09-01', contractLength: '100' }, createdAt: Date.now() });
    await saveProject({ id: 'p2', name: 'Bridge 4', companyCode: code, payItemCatalog: [], contractTimeMode: 'calendar', meta: { ntpDate: '2026-07-01', contractLength: '90' }, createdAt: Date.now() });
    await pushAllLocalData(code);
  });
  await Bp.evaluate(async () => { await saveUserName('Bob'); await createAccount({ name: 'Bob', email: 'bob@example.com', password: 'bobpass12' }); await joinCompanyRoom('roundup-pw-1'); });
  await Bp.evaluate(async () => {
    const mk = async (date, hours, payItems) => { const r = await makeBlankReport(1, await getProject('p1'), null); r.date = date; r.inspectors = [{ name: 'Bob', hours }]; r.payItems = payItems; await saveReport(r); await confirmReportSyncStatus(await getReport(r.id)); };
    await mk('2026-09-30', 8, [{ itemNumber: '201', description: 'Clearing', unit: 'AC', qty: 2 }]);
    await mk('2026-10-01', 9.5, [{ itemNumber: '201', description: 'Clearing', unit: 'AC', qty: 10 }]);
    await mk('2026-10-05', 7, []); // this week: not in the roundup
  });
  check('no managed projects: friendly error', await A.evaluate(() => sendRoundupPreview().then(() => 'sent', (e) => e.message)), "You aren't managing any projects yet. Choose some on the Manager Dashboard first.");
  check('profile picked up a time zone', await A.evaluate(async () => !!(await readAccountProfile((await getAccount()).uid)).timeZone), true);
  await A.evaluate(async () => { await saveManagedProjectIds(['p1', 'p2']); await new Promise((r) => setTimeout(r, 3000)); });
  await A.goto(`${B}/settings.html?tab=account`); await A.waitForTimeout(2000);
  check('roundup toggle on by default', await A.isChecked('#account-roundup'), true);
  await A.click('#btn-account-roundup-preview');
  check('button says Sending while it works', [await A.textContent('#btn-account-roundup-preview'), await A.isDisabled('#btn-account-roundup-preview')], ['Sending\u2026', true]);
  await A.waitForSelector('#btn-account-roundup-preview:has-text("Sent")', { timeout: 15000 }).catch(() => {});
  check('then Sent', await A.textContent('#btn-account-roundup-preview'), 'Sent \u2713');
  await A.screenshot({ path: `${OUT}/feedback-sent.png`, clip: { x: 0, y: 380, width: 1280, height: 340 } });
  check('preview notice', await A.textContent('#account-notice'), "Sent last week's roundup to ada@example.com. It should arrive within a minute or two.");
  await A.waitForTimeout(3500);
  check('button back to normal', [await A.textContent('#btn-account-roundup-preview'), await A.isDisabled('#btn-account-roundup-preview')], ['Send Me a Roundup Now', false]);
  const m = (await outbox('ada@example.com')).pop();
  check('subject', m && m.subject, 'Weekly Roundup: Sep 28 to Oct 4');
  const has = (s) => !!m && m.text.includes(s);
  check('both projects listed', [has('Highway 12'), has('Bridge 4')], [true, true]);
  check('Bob: 2 reports, 17.5 hours', has('Bob') && /Bob[^\n]*2 reports[^\n]*17\.5/.test(m.text), true);
  check('pay item used', has('201') && has('Clearing'), true);
  // Days since the start date depend on today (in UTC or the test
  // account's own time zone, which can be a day behind around midnight).
  const daysSince = (iso) => [0, 1].map((back) => Math.floor((Date.now() - back * 86400000 - Date.parse(iso + 'T00:00:00Z')) / 86400000));
  // Highway 12 counts working days: weekdays from NTP, not
  // Labor Day, worked out by the app's own contract-time.js.
  const ct = {};
  require('vm').runInNewContext(`${require('fs').readFileSync(require('path').join(__dirname, '../../contract-time.js'), 'utf8')};this.tl = projectContractTimeline;`, ct);
  const workingUsed = [0, 1].map((back) => ct.tl({ contractTimeMode: 'working', meta: { ntpDate: '2026-09-01', contractLength: '100' } }, [], new Date(Date.now() - back * 86400000).toISOString().slice(0, 10)).day);
  check('days left (100 minus working days used)', workingUsed.some((d) => has(`Days left: ${100 - d}`)), true);
  check('alert: pay item over plan', has('Item 201 Clearing is over plan: 12 of 10 AC (120%)'), true);
  // Bridge 4 counts calendar days, the NTP date being day 1.
  check('alert: past contract time (calendar days)', daysSince('2026-07-01').some((d) => has(`Past contract time by ${d + 1 - 90} days`)), true);
  check('no links', !!m && !/https?:|href=|<a\s/i.test(m.text + m.html), true);
  require('fs').writeFileSync(`${OUT}/roundup-preview.html`, m ? m.html : '');
  await A.click('#account-roundup'); await A.waitForTimeout(800);
  check('switch shows Saved', await A.textContent('#account-roundup + span + .pref-saved').catch(() => null), 'Saved \u2713');
  await A.waitForTimeout(700);
  check('turned off', await A.evaluate(async () => (await readAccountProfile((await getAccount()).uid)).weeklyRoundup), false);
  check('page errors', errs, []);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
})();
