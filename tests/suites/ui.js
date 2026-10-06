const { devices } = require('../harness');
const { OUT, launchBrowser, emulatorContext, clearEmulators } = require('../harness');
const B = 'http://127.0.0.1:8126';
const NAME = process.env.DEV || 'desktop';
const opts = NAME === 'phone' ? devices['Pixel 7'] : { viewport: { width: 1280, height: 900 } };
let fails = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (wanted ${JSON.stringify(want)})`}`); };
const shot = (p, n) => p.screenshot({ path: `${OUT}/ui-${NAME}-${n}.png`, fullPage: true });
(async () => {
  await clearEmulators();
  const browser = await launchBrowser();
  const errs = [];
  const device = async (name) => { const p = await (await emulatorContext(browser, opts)).newPage(); p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`)); p.on('dialog', (d) => d.accept()); return p; };

  // An admin device sets up the company the old way.
  const admin = await device('admin');
  await admin.goto(`${B}/settings.html`); await admin.waitForTimeout(800);
  await admin.evaluate(async () => { await saveUserName('Alice'); await createCompanyRoom({ name: 'Emu Co', password: 'emu-company-pw', adminPassword: 'emu-admin-pw' }); });

  // 1. New device: create account, then join.
  const p = await device('new');
  await p.goto(`${B}/login.html`); await p.waitForTimeout(800);
  check('login opens on Sign in', [await p.isVisible('#form-signin'), await p.isVisible('#form-create')], [true, false]);
  await shot(p, '1-login');
  await p.click('[data-mode="create"]');
  await p.fill('#ca-name', 'Bob Builder'); await p.fill('#ca-email', 'bob@example.com'); await p.fill('#ca-password', 'short');
  await p.click('#btn-create'); await p.waitForTimeout(300);
  check('short password refused', await p.textContent('#account-error'), 'Choose a password with at least 8 characters.');
  await p.fill('#ca-password', 'bobpass12'); await p.click('#btn-create');
  await p.waitForSelector('#view-company:not([hidden])', { timeout: 10000 });
  check('then asks to join company', await p.textContent('#company-intro'), 'Welcome, Bob Builder. Join your company to see its projects and reports.');
  await shot(p, '2-join');
  await p.fill('#jc-password', 'emu-company-pw'); await p.click('#btn-join');
  await p.waitForURL(/index\.html/, { timeout: 15000 });
  check('lands on home', new URL(p.url()).pathname, '/index.html');

  // 2. Settings shows the account.
  await p.goto(`${B}/settings.html`); await p.waitForTimeout(1500);
  check('settings: signed in', [await p.isVisible('#account-signed-in'), await p.textContent('#account-name'), await p.textContent('#account-email')], [true, 'Bob Builder', '(bob@example.com)']);
  check('settings: role line', await p.textContent('#account-role'), 'Inspector at Emu Co · all projects');
  check('settings: no verify-your-email step', await p.evaluate(() => !document.querySelector('#account-verify')), true);
  await p.click('#btn-account-reset');
  await p.fill('#account-pw-current', 'bobpass12'); await p.fill('#account-pw-new', 'bobpass34'); await p.fill('#account-pw-confirm', 'bobpass34');
  await p.click('#btn-account-pw-save'); await p.waitForTimeout(1500);
  check('settings: change password in the app', await p.textContent('#account-notice'), 'Password changed.');
  check('company tab line', await p.evaluate(() => document.querySelector('#company-line').textContent), 'Connected to "Emu Co" · Inspector');
  await shot(p, '3-settings');

  // 3. Rename updates the member record.
  await p.fill('#f-user-name', 'Bob B.'); await p.click('#btn-save-user-name'); await p.waitForTimeout(800);
  check('rename reaches member record', await p.evaluate(async () => (await getMyMembership()).displayName), 'Bob B.');

  // 4. Sign out.
  await p.click('#btn-account-signout'); await p.waitForURL(/login\.html/, { timeout: 10000 });
  check('signed out to login, no company', await p.evaluate(async () => [await getCompanyRoom(), await getAccount()]), [null, null]);

  // 5. Fresh device signs in: reconnects automatically.
  const q = await device('fresh');
  await q.goto(`${B}/login.html`); await q.waitForTimeout(800);
  await q.fill('#si-email', 'bob@example.com'); await q.fill('#si-password', 'wrong-pass');
  await q.click('#btn-signin'); await q.waitForTimeout(1500);
  check('wrong password shown', await q.textContent('#account-error'), 'Email or password is incorrect.');
  await q.fill('#si-password', 'bobpass34'); await q.click('#btn-signin');
  await q.waitForURL(/index\.html/, { timeout: 15000 });
  check('fresh device: straight in, company connected', await q.evaluate(async () => [(await getCompanyRoom()).name, await getUserName()]), ['Emu Co', 'Bob B.']);

  // 6. Existing old-login device adds an account from Settings.
  const r = await device('legacy');
  await r.goto(`${B}/login.html`); await r.waitForTimeout(800);
  await r.click('#btn-show-legacy');
  await r.fill('#f-name', 'Carl'); await r.fill('#f-password', 'emu-company-pw'); await r.click('#btn-continue');
  await r.waitForURL(/index\.html/, { timeout: 15000 });
  await r.goto(`${B}/settings.html`); await r.waitForTimeout(1200);
  check('legacy device: settings offers account', await r.isVisible('#account-signed-out'), true);
  await r.click('#account-create-link'); await r.waitForTimeout(800);
  check('create tab preselected, not skipped', [new URL(r.url()).pathname, await r.isVisible('#form-create')], ['/login.html', true]);
  await r.fill('#ca-name', 'Carl'); await r.fill('#ca-email', 'carl@example.com'); await r.fill('#ca-password', 'carlpass1'); await r.click('#btn-create');
  await r.waitForURL(/settings\.html/, { timeout: 15000 }); await r.waitForTimeout(1500);
  check('back in settings, member of the company it was already in', await r.textContent('#account-role'), 'Inspector at Emu Co · all projects');
  check('no sideways scroll', await r.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  check('page errors', errs, []);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
})();
