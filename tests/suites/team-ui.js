const { devices } = require('../harness');
const { OUT, launchBrowser, emulatorContext, clearEmulators } = require('../harness');
const B = 'http://127.0.0.1:8126';
const NAME = process.env.DEV || 'desktop';
const opts = NAME === 'phone' ? devices['Pixel 7'] : { viewport: { width: 1280, height: 900 } };
let fails = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (wanted ${JSON.stringify(want)})`}`); };
const verifyEmail = async (uid) => fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/daily-reports-test/accounts:update', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ localId: uid, emailVerified: true }) });
const shot = (p, n) => p.screenshot({ path: `${OUT}/team-${NAME}-${n}.png`, fullPage: true });
const txt = (p, sel) => p.evaluate((s) => Array.from(document.querySelectorAll(s)).map((e) => e.textContent.replace(/\s+/g, ' ').trim()), sel);
(async () => {
  await clearEmulators();
  const browser = await launchBrowser();
  const errs = [];
  const alerts = {};
  const device = async (name) => { const p = await (await emulatorContext(browser, opts)).newPage(); p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`)); p.on('dialog', (d) => { alerts[name] = d.message(); d.accept(); }); return p; };

  const A = await device('A');
  await A.goto(`${B}/settings.html`); await A.waitForTimeout(800);
  await A.evaluate(async () => {
    await saveUserName('Alice');
    await createCompanyRoom({ name: 'Team Co', password: 'team-pw-1', adminPassword: 'team-admin-1' });
    const code = (await getCompanyRoom()).code;
    for (const [id, name] of [['p1', 'Highway 12'], ['p2', 'Bridge Repair']]) await saveProject({ id, name, companyCode: code, payItemCatalog: [], meta: { projectNo: id }, createdAt: Date.now() });
    await pushAllLocalData(code);
  });
  const openTeam = async () => { await A.goto(`${B}/settings.html?tab=company`); await A.waitForTimeout(1500); await A.evaluate(() => { document.querySelector('#team-section').open = true; }); await A.waitForTimeout(300); };
  await openTeam();
  check('admin without account: sign-in prompt', [await A.isVisible('#team-signed-out'), await A.isVisible('#team-body')], [true, false]);
  await A.evaluate(() => createAccount({ name: 'Alice', email: 'alice@example.com', password: 'alicepass1' }));
  await openTeam();
  check('team: Alice listed as admin (you)', await txt(A, '#team-members .cm-project-name'), ['Alice You']);
  check('team: own row has no Remove/Turn Off', await A.evaluate(() => [!!document.querySelector('#team-members [data-team-remove]'), !!document.querySelector('#team-members [data-team-toggle]')]), [false, false]);
  await A.click('#team-require-approval'); await A.waitForTimeout(1000);
  check('approval toggle saved', await A.evaluate(async () => (await listTeam()).requireApproval), true);

  // B signs up on the login page and waits.
  const Bp = await device('B');
  await Bp.goto(`${B}/login.html`); await Bp.waitForTimeout(800);
  await Bp.click('[data-mode="create"]');
  await Bp.fill('#ca-name', 'Bob'); await Bp.fill('#ca-email', 'bob@example.com'); await Bp.fill('#ca-password', 'bobpass12');
  await Bp.click('#btn-create');
  await Bp.waitForSelector('#view-company:not([hidden])', { timeout: 10000 });
  await Bp.fill('#jc-password', 'team-pw-1'); await Bp.click('#btn-join');
  await Bp.waitForSelector('#view-pending:not([hidden])', { timeout: 10000 });
  check('B shown the waiting screen', await Bp.textContent('#pending-text').then((t) => /Team Co/.test(t)), true);
  await shot(Bp, '1-pending');
  await Bp.click('#btn-pending-check'); await Bp.waitForTimeout(1500);
  check('B still waiting after Check Again', await Bp.isVisible('#view-pending'), true);

  await openTeam();
  check('A sees Bob waiting', await txt(A, '#team-pending .cm-project-name'), ['Bob']);
  check('summary counts waiting', await A.textContent('#team-sub'), '1 member · 1 waiting');
  await shot(A, '2-waiting');
  await A.click('#team-pending [data-team-approve]'); await A.waitForTimeout(1500);
  check('approved: Bob in members', await txt(A, '#team-members .cm-project-name'), ['Alice You', 'Bob']);
  check('approved message', (await A.textContent('#team-status')).startsWith('Bob approved'), true);

  await Bp.click('#btn-pending-check');
  await Bp.waitForURL(/index\.html/, { timeout: 15000 });
  check('B connected after approval', await Bp.evaluate(async () => (await getCompanyRoom()).name), 'Team Co');

  // Role + projects for Bob through the UI.
  const bobRow = '#team-members .cm-project-row:nth-child(2)';
  await A.selectOption(`${bobRow} [data-team-role]`, 'manager'); await A.waitForTimeout(1500);
  check('role change message', await A.textContent('#team-status'), 'Bob is now a Manager.');
  await A.click(`${bobRow} [data-team-projects]`);
  await A.click(`${bobRow} [data-team-all]`);
  await A.click(`${bobRow} [data-team-save-projects]`); await A.waitForTimeout(500);
  check('no projects picked refused', await A.textContent('#team-error'), 'Pick at least one project, or choose All projects.');
  await A.check(`${bobRow} .team-project-check[value="p1"]`);
  await A.click(`${bobRow} [data-team-save-projects]`); await A.waitForTimeout(1500);
  check('Bob row shows manager + Highway 12', [await A.inputValue(`${bobRow} [data-team-role]`), (await txt(A, `${bobRow} .team-row-sub`))[0]], ['manager', 'bob@example.com · Highway 12']);
  await shot(A, '3-members');
  await Bp.evaluate(() => autoPullCompanyData(true));
  check('B now manager on Highway 12 only', await Bp.evaluate(async () => { const room = await getCompanyRoom(); return [await companyCan('approveReports'), (await getAllProjects()).filter((p) => projectInScope(p, room)).map((p) => p.id)]; }), [true, ['p1']]);

  // Pre-approve Carol.
  await A.evaluate(() => { document.querySelector('#team-invite-details').open = true; });
  await A.fill('#team-invite-email', 'not-an-email'); await A.click('#btn-team-invite'); await A.waitForTimeout(500);
  check('bad email refused', await A.textContent('#team-error'), 'Enter a valid email address.');
  await A.fill('#team-invite-email', 'Carol@Example.com');
  await A.click('#team-invite-projects [data-team-all]');
  await A.check('#team-invite-projects .team-project-check[value="p2"]');
  await A.click('#btn-team-invite'); await A.waitForTimeout(1500);
  check('invite listed', [await txt(A, '#team-invites .cm-project-name'), (await txt(A, '#team-invites .team-row-sub'))[0]], [['carol@example.com'], 'Inspector · Bridge Repair · added by Alice']);
  check('pre-approved emails offer no Admin role', await A.evaluate(() => Array.from(document.querySelectorAll('#team-invite-role option')).map((o) => o.value)), ['inspector', 'manager']);
  await shot(A, '4-invites');

  const C = await device('C');
  await C.goto(`${B}/login.html`); await C.waitForTimeout(800);
  await C.click('[data-mode="create"]');
  await C.fill('#ca-name', 'Carol'); await C.fill('#ca-email', 'carol@example.com'); await C.fill('#ca-password', 'carolpass1');
  await C.click('#btn-create');
  await C.waitForURL(/index\.html/, { timeout: 15000 });
  check('C joined right after signing up, Bridge Repair only', await C.evaluate(async () => { const room = await getCompanyRoom(); return [room.name, (await getAllProjects()).filter((p) => projectInScope(p, room)).map((p) => p.id)]; }), ['Team Co', ['p2']]);

  // Remove Carol, turn Bob off: their devices leave on next sync.
  await openTeam();
  check('invite gone once used', await txt(A, '#team-invites .cm-project-name'), []);
  const carolRow = await A.evaluate(() => Array.from(document.querySelectorAll('#team-members .cm-project-row')).findIndex((r) => r.textContent.includes('Carol')) + 1);
  await A.click(`#team-members .cm-project-row:nth-child(${carolRow}) [data-team-remove]`); await A.waitForTimeout(1500);
  check('Carol removed', (await txt(A, '#team-members .cm-project-name')).some((n) => n.includes('Carol')), false);
  await C.evaluate(() => { autoPullCompanyData(true); });
  await C.waitForTimeout(3000);
  check('C told she was removed, disconnected', [alerts.C, await C.evaluate(() => getCompanyRoom())], ["An admin removed you from Team Co. This device has left the company. Anything that hadn't uploaded yet is still saved here.", null]);
  check('C member record not recreated', await A.evaluate(async () => (await listTeam()).members.map((m) => m.email).sort()), ['alice@example.com', 'bob@example.com']);

  await A.click(`${bobRow} [data-team-toggle]`); await A.waitForTimeout(1500);
  check('Bob shows Turned off', (await txt(A, '#team-members .cm-project-name'))[1], 'Bob Turned off');
  await Bp.evaluate(() => { autoPullCompanyData(true); });
  await Bp.waitForTimeout(3000);
  check('B told access is off', alerts.B, "An admin turned off your access to Team Co. This device has left the company. Anything that hadn't uploaded yet is still saved here.");
  await A.click(`${bobRow} [data-team-toggle]`); await A.waitForTimeout(1500);
  check('Bob back on', (await txt(A, '#team-members .cm-project-name'))[1], 'Bob');
  await shot(A, '6-final');

  const overflow = await A.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('no horizontal scroll', overflow, false);
  check('page errors', errs, []);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
})();
