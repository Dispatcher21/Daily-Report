const { OUT, launchBrowser, emulatorContext, clearEmulators } = require('../harness');
const B = 'http://127.0.0.1:8126';
let fails = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (wanted ${JSON.stringify(want)})`}`); };
const adminDoc = async (path) => (await (await fetch(`http://127.0.0.1:8080/v1/projects/daily-reports-test/databases/(default)/documents/${path}`, { headers: { Authorization: 'Bearer owner' } })).json());
const field = (d, f) => { const v = d.fields && d.fields[f]; if (!v) return undefined; return v.stringValue ?? v.booleanValue ?? v.nullValue ?? (v.arrayValue ? (v.arrayValue.values || []).map((x) => x.stringValue) : v); };
(async () => {
  await clearEmulators();
  const browser = await launchBrowser();
  const errs = [];
  const device = async (name) => { const p = await (await emulatorContext(browser)).newPage(); p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`)); await p.goto(`${B}/settings.html`); await p.waitForTimeout(1000); return p; };

  // A: legacy admin, then makes an account.
  const A = await device('A');
  const ids = await A.evaluate(async () => {
    await saveUserName('Alice');
    await createCompanyRoom({ name: 'Emu Co', password: 'emu-company-pw', adminPassword: 'emu-admin-pw' });
    const code = (await getCompanyRoom()).code;
    const p1 = { id: 'p1', name: 'P1 Bridge', companyCode: code, payItemCatalog: [], createdAt: Date.now() };
    const p2 = { id: 'p2', name: 'P2 Drainage', companyCode: code, payItemCatalog: [], createdAt: Date.now() };
    await saveProject(p1); await saveProject(p2);
    const anonUid = window.FirebaseCore.auth.currentUser.uid;
    await createAccount({ name: 'Alice', email: 'alice@example.com', password: 'alicepass1' });
    return { code, anonUid, uid: window.FirebaseCore.auth.currentUser.uid };
  });
  check('A: account keeps the same user id (upgraded in place)', ids.uid, ids.anonUid);
  const aMember = await adminDoc(`companies/${ids.code}/members/${ids.uid}`);
  check('A: recorded as admin member', [field(aMember, 'role'), field(aMember, 'status'), field(aMember, 'email')], ['admin', 'active', 'alice@example.com']);
  check('A: profile remembers company', field(await adminDoc(`users/${ids.uid}`), 'companyCode'), ids.code);

  // B: account first, then joins with the company password.
  const Bp = await device('B');
  const bUid = await Bp.evaluate(async () => { await createAccount({ name: 'Bob', email: 'bob@example.com', password: 'bobpass12' }); await joinCompanyRoom('emu-company-pw'); return window.FirebaseCore.auth.currentUser.uid; });
  check('B: joined as inspector', field(await adminDoc(`companies/${ids.code}/members/${bUid}`), 'role'), 'inspector');
  check('B: inspector permissions on device', await Bp.evaluate(async () => [await companyCan('approveReports'), (await getReportPermissionContext()).canEditOwn, (await getCompanyRoom()).isAdmin]), [false, true, false]);
  await Bp.waitForTimeout(800); await Bp.reload(); await Bp.waitForTimeout(1200);
  check('B: still signed in after reload', await Bp.evaluate(async () => (await getAccount()).email), 'bob@example.com');

  // A (admin) makes Bob a manager limited to P1 -- straight in the database for now (the roster screen is Slice 2).
  await A.evaluate(async ([code, uid]) => { const { db } = window.FirebaseCore; const { doc, setDoc } = await import(FIRESTORE_SDK); await setDoc(doc(db, 'companies', code, 'members', uid), { role: 'manager', projectIds: ['p1'] }, { merge: true }); }, [ids.code, bUid]);
  await Bp.evaluate(() => autoPullCompanyData(true));
  check('B: picks up manager role', await Bp.evaluate(async () => [await companyCan('approveReports'), await companyCan('createProjects')]), [true, true]);
  check('B: sees only P1 now', await Bp.evaluate(async () => { const room = await getCompanyRoom(); return (await getAllProjects()).filter((p) => projectInScope(p, room)).map((p) => p.name); }), ['P1 Bridge']);

  // C: fresh device, signs in as Bob -- no company password.
  const C = await device('C');
  const cRes = await C.evaluate(async () => { await saveUserName(''); return signInAccount({ email: 'bob@example.com', password: 'bobpass12' }); });
  check('C: sign-in reconnects to the company', cRes, { company: 'Emu Co', rejoined: true });
  check('C: name from account, manager, only P1', await C.evaluate(async () => { const room = await getCompanyRoom(); return [await getUserName(), await companyCan('approveReports'), (await getAllProjects()).filter((p) => projectInScope(p, room)).map((p) => p.name)]; }), ['Bob', true, ['P1 Bridge']]);
  await C.evaluate(() => signOutAccount());
  check('C: signed out -- no company, no name, no account', await C.evaluate(async () => [await getCompanyRoom(), await getUserName(), await getAccount()]), [null, '', null]);
  check('C: wrong password message', await C.evaluate(() => signInAccount({ email: 'bob@example.com', password: 'nope-nope' }).then(() => 'signed in?', (e) => e.message)), 'Email or password is incorrect.');

  // D: no account. Waits for an admin, recorded on Team, nothing pulled.
  const D = await device('D');
  const dRes = await D.evaluate(async () => { await saveUserName('Dana'); const r = await joinCompanyRoom('emu-company-pw').then(() => 'joined', (e) => e.code); return [r, await getCompanyRoom(), (await getAllProjects()).length]; });
  check('D: without an account, waits for an admin with nothing pulled', dRes, ['pending-approval', null, 0]);
  const members = await (await fetch(`http://127.0.0.1:8080/v1/projects/daily-reports-test/databases/(default)/documents/companies/${ids.code}/members`, { headers: { Authorization: 'Bearer owner' } })).json();
  const dDoc = (members.documents || []).find((d) => d.fields.displayName && d.fields.displayName.stringValue === 'Dana');
  check('D is on the team list, waiting, with no projects', [(members.documents || []).length, dDoc && dDoc.fields.status.stringValue, dDoc && dDoc.fields.noAccount.booleanValue], [3, 'pending', true]);
  check('duplicate email message', await D.evaluate(() => createAccount({ name: 'X', email: 'alice@example.com', password: 'whatever12' }).then(() => 'created?', (e) => e.message)), 'That email already has an account. Sign in instead.');
  check('page errors', errs, []);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
})();
