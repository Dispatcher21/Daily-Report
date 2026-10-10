const { OUT, launchBrowser, emulatorContext, clearEmulators } = require('../harness');
const B = 'http://127.0.0.1:8126';
let fails = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (wanted ${JSON.stringify(want)})`}`); };
const outbox = async (to) => {
  const r = await (await fetch('http://127.0.0.1:8080/v1/projects/daily-reports-test/databases/(default)/documents/devOutbox?pageSize=300', { headers: { Authorization: 'Bearer owner' } })).json();
  return (r.documents || []).map((d) => ({ to: d.fields.to.stringValue, subject: d.fields.subject.stringValue, text: d.fields.text.stringValue, html: d.fields.html.stringValue, at: Number(d.fields.at.integerValue) })).filter((m) => m.to === to).sort((a, b) => a.at - b.at);
};
const lastCode = async (to) => { const m = (await outbox(to)).pop(); return m ? { code: (m.text.match(/Your code is: (\d{6})/) || [])[1], ...m } : null; };
(async () => {
  await clearEmulators();
  const browser = await launchBrowser();
  const errs = [];
  const device = async (n, page = 'settings.html') => { const p = await (await emulatorContext(browser)).newPage(); p.on('pageerror', (e) => errs.push(`${n}: ${e.message}`)); p.on('dialog', (d) => d.accept()); await p.goto(`${B}/${page}`); await p.waitForTimeout(1000); return p; };
  const A = await device('A'), Bp = await device('B');
  await A.evaluate(async () => { await saveUserName('Ada'); await createAccount({ name: 'Ada', email: 'ada@example.com', password: 'adapass12' }); await createCompanyRoom({ name: 'Reset Co', password: 'reset-pw-1', adminPassword: 'reset-admin-1' }); });
  const bUid = await Bp.evaluate(async () => { await createAccount({ name: 'Bob', email: 'bob@example.com', password: 'bobpass12' }); await joinCompanyRoom('reset-pw-1'); return window.FirebaseCore.auth.currentUser.uid; });

  // Forgot password, self-service.
  const L = await device('L', 'login.html');
  await L.fill('#si-email', 'bob@example.com'); await L.click('#btn-forgot');
  await L.click('#btn-rp-send'); await L.waitForTimeout(4000);
  const c1 = await lastCode('bob@example.com');
  check('code emailed, no link', !!c1 && /^\d{6}$/.test(c1.code) && !/https?:|href=/i.test(c1.text + c1.html), true);
  await L.click('#btn-rp-send'); await L.waitForTimeout(1500);
  check('asking again right away is limited', await L.textContent('#account-error'), 'A code was just sent. Wait a minute before asking for another.');
  await L.fill('#rp-code', '000000'); await L.fill('#rp-password', 'bobnewpass1'); await L.click('#btn-rp-save'); await L.waitForTimeout(2000);
  check('wrong code refused', await L.textContent('#account-error'), "That code isn't right. Check the email and try again.");
  await L.fill('#rp-code', c1.code); await L.click('#btn-rp-save');
  await L.waitForURL(/index\.html/, { timeout: 20000 });
  check('new password saved, signed in, back in the company', await L.evaluate(async () => [(await getAccount()).email, (await getCompanyRoom()).name]), ['bob@example.com', 'Reset Co']);

  // Unknown email: same answer, nothing sent.
  const U = await device('U', 'login.html');
  await U.click('#btn-forgot'); await U.fill('#rp-email', 'nobody@example.com'); await U.click('#btn-rp-send'); await U.waitForTimeout(3000);
  check('unknown email: same notice, nothing sent', [(await U.textContent('#account-notice')).startsWith('If that email has an account'), (await outbox('nobody@example.com')).length], [true, 0]);

  // Admin sends a code from the Team list.
  await A.goto(`${B}/settings.html?tab=company`); await A.waitForTimeout(2000);
  await A.evaluate(() => { document.querySelector('#team-section').open = true; });
  await new Promise((r) => setTimeout(r, 61000)); // past the one-a-minute limit
  await A.click('#team-members [data-team-resetpw]'); await A.waitForTimeout(4000);
  check('admin: sent message', await A.textContent('#team-status'), 'Reset code sent to bob@example.com. It works for 15 minutes.');
  const c2 = await lastCode('bob@example.com');
  check('email says the admin sent it', !!c2 && c2.text.includes('Ada sent you a code'), true);
  const L2 = await device('L2', 'login.html');
  await L2.click('#btn-forgot'); await L2.fill('#rp-email', 'bob@example.com'); await L2.click('#btn-rp-have');
  await L2.fill('#rp-code', c2.code); await L2.fill('#rp-password', 'bobthird123'); await L2.click('#btn-rp-save');
  await L2.waitForURL(/index\.html/, { timeout: 20000 });
  check('"I have a code" path works', await L2.evaluate(async () => (await getAccount()).email), 'bob@example.com');
  // Ten wrong guesses at once use up the five tries. (The emulator runs
  // calls one at a time, so this checks the counting, not the race the
  // transaction in resetPasswordWithCode guards against on the live server.)
  await new Promise((r) => setTimeout(r, 61000)); // past the one-a-minute limit
  await L2.evaluate(() => sendAccountPasswordReset('bob@example.com')); await L2.waitForTimeout(3000);
  const c3 = await lastCode('bob@example.com');
  const wrong = c3.code === '111111' ? '222222' : '111111';
  await L2.evaluate((wrong) => Promise.all(Array.from({ length: 10 }, () => resetAccountPassword({ email: 'bob@example.com', code: wrong, password: 'bobfourth12' }).catch(() => {}))), wrong);
  check('ten wrong guesses use up the tries', await L2.evaluate((code) => resetAccountPassword({ email: 'bob@example.com', code, password: 'bobfourth12' }).then(() => 'reset', (e) => e.message), c3.code), 'Too many wrong tries. Ask for a new code.');
  check('non-admin cannot use the admin button', await Bp.evaluate((uid) => adminSendResetCode(uid).then(() => 'sent', (e) => e.message), bUid), 'Only an admin can do that.');
  check('codes are unreadable to the app', await Bp.evaluate(async () => { const { collection, getDocs } = await import(FIRESTORE_SDK); return getDocs(collection(window.FirebaseCore.db, 'emailCodes')).then(() => 'READABLE', (e) => e.code); }), 'permission-denied');
  check('page errors', errs, []);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
})();
