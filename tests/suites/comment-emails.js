const { OUT, launchBrowser, emulatorContext, clearEmulators } = require('../harness');
const B = 'http://127.0.0.1:8126';
let fails = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (wanted ${JSON.stringify(want)})`}`); };
const outbox = async () => {
  const r = await (await fetch('http://127.0.0.1:8080/v1/projects/daily-reports-test/databases/(default)/documents/devOutbox?pageSize=300', { headers: { Authorization: 'Bearer owner' } })).json();
  return (r.documents || []).map((d) => ({ to: d.fields.to.stringValue, subject: d.fields.subject.stringValue, text: d.fields.text.stringValue, html: d.fields.html.stringValue, at: Number(d.fields.at.integerValue) })).sort((a, b) => a.at - b.at);
};
let seen = 0;
const newMail = async (wait = 6000) => { await new Promise((r) => setTimeout(r, wait)); const all = await outbox(); const fresh = all.slice(seen); seen = all.length; return fresh; };
(async () => {
  await clearEmulators();
  const browser = await launchBrowser();
  const errs = [];
  const device = async (n) => { const p = await (await emulatorContext(browser)).newPage(); p.on('pageerror', (e) => errs.push(`${n}: ${e.message}`)); await p.goto(`${B}/settings.html`); await p.waitForTimeout(800); return p; };
  const A = await device('A'), Bp = await device('B'), M = await device('M');
  await A.evaluate(async () => {
    await saveUserName('Ada'); await createAccount({ name: 'Ada', email: 'ada@example.com', password: 'adapass12' });
    await createCompanyRoom({ name: 'Notify Co', password: 'notify-pw-1', adminPassword: 'notify-admin-1' });
    const code = (await getCompanyRoom()).code;
    await saveProject({ id: 'p1', name: 'Highway 12', companyCode: code, payItemCatalog: [], meta: { projectNo: 'H12' }, createdAt: Date.now() });
    await pushAllLocalData(code);
  });
  await Bp.evaluate(async () => { await createAccount({ name: 'Bob', email: 'bob@example.com', password: 'bobpass12' }); await joinCompanyRoom('notify-pw-1'); });
  const mUid = await M.evaluate(async () => { await createAccount({ name: 'Mia', email: 'mia@example.com', password: 'miapass12' }); await joinCompanyRoom('notify-pw-1'); return window.FirebaseCore.auth.currentUser.uid; });
  await A.evaluate((uid) => updateTeamMember(uid, { role: 'manager' }), mUid);
  await M.evaluate(() => autoPullCompanyData(true));
  const reportId = await Bp.evaluate(async () => { const r = await makeBlankReport(1, await getProject('p1'), null); r.date = '2026-10-01'; await saveReport(r); await confirmReportSyncStatus(await getReport(r.id)); return r.id; });
  await newMail(3000);

  const pull = (p) => p.evaluate(() => autoPullCompanyData(true));
  await pull(M);
  await M.evaluate((id) => saveReportApproval(id, { comment: 'Please add the truck count.' }), reportId);
  let mail = await newMail();
  check('manager comment: only the author is emailed', mail.map((m) => m.to), ['bob@example.com']);
  check('subject names the report', mail[0] && mail[0].subject, 'New comment on your daily report #1 for Highway 12 (2026-10-01)');
  check('text has who and what', !!mail[0] && mail[0].text.includes('Mia commented on your daily report') && mail[0].text.includes('"Please add the truck count."'), true);
  check('no links in the email', !!mail[0] && !/https?:|www\.|href=|<a\s/i.test(mail[0].text + mail[0].html), true);

  await M.evaluate((id) => saveReportApproval(id, { status: 'changes_requested', comment: 'And the weather.' }), reportId);
  mail = await newMail();
  check('changes requested + comment: one email to the author', [mail.map((m) => m.to), !!mail[0] && mail[0].text.includes('And the weather.') && mail[0].text.includes('Mia asked for changes on your daily report')], [['bob@example.com'], true]);

  await pull(A);
  await A.evaluate((id) => saveReportApproval(id, { comment: 'Agreed.' }), reportId);
  mail = await newMail();
  check('admin comment: author and earlier commenter, not the admin', mail.map((m) => m.to).sort(), ['bob@example.com', 'mia@example.com']);
  check('earlier commenter is told it is not theirs', !!mail.find((m) => m.to === 'mia@example.com' && m.subject === 'New comment on the daily report #1 for Highway 12 (2026-10-01)'), true);

  // Replies.
  await pull(Bp);
  const miaCommentId = await Bp.evaluate(async (id) => (await getReport(id)).comments.find((c) => c.author === 'Mia').id, reportId);
  await Bp.evaluate(({ id, parentId }) => saveReportApproval(id, { comment: 'Added it.', parentId }), { id: reportId, parentId: miaCommentId });
  mail = await newMail();
  check('owner replies: only the person replied to is emailed', mail.map((m) => [m.to, m.subject]), [['mia@example.com', 'New reply on the daily report #1 for Highway 12 (2026-10-01)']]);
  check('reply email says it answers their comment', !!mail[0] && mail[0].text.includes('Bob replied to your comment'), true);
  await pull(A);
  await A.evaluate(({ id, parentId }) => saveReportApproval(id, { comment: 'Thanks both.', parentId }), { id: reportId, parentId: miaCommentId });
  mail = await newMail();
  check('admin replies: commenter and owner emailed', mail.map((m) => m.to).sort(), ['bob@example.com', 'mia@example.com']);
  await Bp.goto(`${B}/settings.html`); await Bp.waitForTimeout(1500);
  check('settings toggle starts on', await Bp.isChecked('#account-email-comments'), true);
  await Bp.click('#account-email-comments'); await Bp.waitForTimeout(1000);
  await pull(M);
  await M.evaluate((id) => saveReportApproval(id, { status: 'approved' }), reportId);
  mail = await newMail();
  check('emails off: author not emailed on approval', mail.map((m) => m.to), []);
  await Bp.click('#account-email-comments'); await Bp.waitForTimeout(1000);
  await pull(M);
  await M.evaluate((id) => saveReportApproval(id, { status: 'changes_requested' }), reportId);
  mail = await newMail();
  check('emails back on', mail.map((m) => [m.to, m.subject]), [['bob@example.com', 'Changes requested: your daily report #1 for Highway 12 (2026-10-01)']]);

  // An older report from before accounts: matched by name.
  const oldId = await A.evaluate(async () => { const r = await makeBlankReport(2, await getProject('p1'), null); r.date = '2026-09-01'; r.createdBy = 'Bob'; delete r.createdByUid; await putReportRaw({ ...r, companyCode: (await getCompanyRoom()).code }); await pushReportToCompany((await getCompanyRoom()).code, await getReport(r.id)); return r.id; });
  await newMail(3000);
  await pull(M);
  await M.evaluate((id) => saveReportApproval(id, { comment: 'Old one, looks good.' }), oldId);
  mail = await newMail();
  check('pre-account report: author found by name', mail.map((m) => m.to), ['bob@example.com']);

  // Pay App.
  await pull(Bp);
  const estId = await Bp.evaluate(async () => { const p = await getProject('p1'); const e = { id: crypto.randomUUID(), estimateNo: 1, date: '2026-10-05', note: '', itemTotals: {}, createdBy: 'Bob', createdByUid: window.FirebaseCore.auth.currentUser.uid }; p.billingEstimates = [...(p.billingEstimates || []), e]; await saveProject(p); await new Promise((r) => setTimeout(r, 2000)); return e.id; });
  await newMail(3000);
  await pull(M);
  await M.evaluate((id) => saveBillingEstimateApproval('p1', id, { comment: 'Check item 3.' }), estId);
  mail = await newMail();
  check('Pay App comment emails who recorded it', mail.map((m) => [m.to, m.subject]), [['bob@example.com', 'New comment on your Pay App #1 for Highway 12 (2026-10-05)']]);
  await pull(Bp);
  // Two people named Bob: an old name-only report no longer guesses.
  const B2 = await device('B2');
  await B2.evaluate(async () => { await createAccount({ name: 'Bob', email: 'bob.two@example.com', password: 'bobtwo123' }); await joinCompanyRoom('notify-pw-1'); });
  await pull(M);
  await M.evaluate((id) => saveReportApproval(id, { comment: 'Which Bob?' }), oldId);
  mail = await newMail();
  check('same name twice: no guessing on old reports', mail.map((m) => m.to), []);
  check('page errors', errs, []);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
})();
