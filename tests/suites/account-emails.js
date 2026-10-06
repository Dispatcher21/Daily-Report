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
  const device = async (n, page = 'settings.html') => { const p = await (await emulatorContext(browser)).newPage(); p.on('pageerror', (e) => errs.push(`${n}: ${e.message}`)); p.on('dialog', (d) => { errs.push(`${n} dialog: ${d.message()}`); d.accept(); }); await p.goto(`${B}/${page}`); await p.waitForTimeout(1000); return p; };
  const A = await device('A'), Bp = await device('B'), D = await device('D');
  await A.evaluate(async () => { await saveUserName('Ada'); await createAccount({ name: 'Ada', email: 'ada@example.com', password: 'adapass12' }); await createCompanyRoom({ name: 'Mail Co', password: 'mail-pw-1', adminPassword: 'mail-admin-1' }); await setRequireApproval(true); });

  // 1. Join request goes to the admin.
  const bUid = await Bp.evaluate(async () => { await saveUserName('Bob'); await createAccount({ name: 'Bob', email: 'bob@example.com', password: 'bobpass12' }); await joinCompanyRoom('mail-pw-1').catch(() => {}); return window.FirebaseCore.auth.currentUser.uid; });
  await wait(4000);
  let m = (await outbox('ada@example.com')).pop();
  check('join request emailed to admin', m && [m.subject, m.text.includes('Bob (bob@example.com) asked to join Mail Co')], ['Bob asked to join Mail Co', true]);

  // 2. Approval goes to the person.
  await A.evaluate((uid) => updateTeamMember(uid, { status: 'active' }), bUid);
  await wait(4000);
  m = (await outbox('bob@example.com')).pop();
  check('approval emailed', m && [m.subject, m.text.includes('as an Inspector')], ["You're approved to join Mail Co", true]);
  const adaCount = (await outbox('ada@example.com')).length;

  // 3. Invite.
  await A.evaluate(() => inviteTeamMember({ email: 'Cara@Example.com', role: 'manager', projectIds: null }));
  await wait(4000);
  m = (await outbox('cara@example.com')).pop();
  check('invite emailed', m && [m.subject, m.text.includes('Ada invited you to join Mail Co on Daily Work Reports as a Manager'), m.text.includes('inspector-manager.com')], ["You're invited to join Mail Co on Daily Work Reports", true, true]);

  // Join-request emails can be turned off.
  await A.goto(`${B}/settings.html`); await A.waitForTimeout(2500);
  check('admin sees the join-request switch, on', [await A.isVisible('#account-join-requests'), await A.isChecked('#account-join-requests')], [true, true]);
  await A.click('#account-join-requests'); await A.waitForTimeout(1500);
  await D.evaluate(async () => { await saveUserName('Dan'); await createAccount({ name: 'Dan', email: 'dan@example.com', password: 'danpass12' }); await joinCompanyRoom('mail-pw-1').catch(() => {}); });
  await wait(4000);
  check('turned off: no email for the next request', (await outbox('ada@example.com')).length, adaCount);

  // 4. Password changed: in Settings, and by reset code.
  await Bp.goto(`${B}/settings.html`); await Bp.waitForTimeout(2500);
  check('non-admin has no join-request switch', await Bp.isVisible('#account-join-requests'), false);
  await Bp.evaluate(() => changeAccountPassword('bobpass12', 'bobpass34'));
  await wait(4000);
  m = (await outbox('bob@example.com')).pop();
  check('settings change: notice', m && [m.subject, m.text.includes('was just changed in Settings')], ['Your Daily Work Reports password was changed', true]);
  await Bp.evaluate(() => sendAccountPasswordReset('bob@example.com'));
  await wait(3000);
  const code = ((await outbox('bob@example.com')).pop().text.match(/Your code is: (\d{6})/) || [])[1];
  await Bp.evaluate((code) => resetAccountPassword({ email: 'bob@example.com', code, password: 'bobpass56' }), code);
  await wait(3000);
  m = (await outbox('bob@example.com')).pop();
  check('reset code: notice', !!m && m.text.includes('with an emailed reset code'), true);
  const all = [...await outbox('ada@example.com'), ...await outbox('bob@example.com'), ...await outbox('cara@example.com')];
  check('no links in any of them', all.filter((x) => /https?:|href=|<a\s/i.test(x.text + x.html)).length, 0);
  await A.screenshot({ path: `${OUT}/email-settings.png`, fullPage: false });
  check('page errors', errs, []);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
})();
