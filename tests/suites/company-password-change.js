const { OUT, launchBrowser, emulatorContext, clearEmulators } = require('../harness');
const B = 'http://127.0.0.1:8126';
let fails = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (wanted ${JSON.stringify(want)})`}`); };
(async () => {
  await clearEmulators();
  const browser = await launchBrowser();
  const errs = [];
  const device = async (n) => { const p = await (await emulatorContext(browser)).newPage(); p.on('pageerror', (e) => errs.push(`${n}: ${e.message}`)); p.on('dialog', (d) => d.accept()); await p.goto(`${B}/settings.html`); await p.waitForTimeout(800); return p; };
  const A = await device('A'), Bp = await device('B'), L = await device('L');
  const oldCode = await A.evaluate(async () => {
    await saveUserName('Alice');
    // A logo, as if from some earlier company, must not leak into this one... (checked on L below)
    await createCompanyRoom({ name: 'PW Co', password: 'pw-old-1', adminPassword: 'pw-admin-1' });
    await createAccount({ name: 'Alice', email: 'alice@example.com', password: 'alicepass1' });
    const code = (await getCompanyRoom()).code;
    await saveReportLogo(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
    await pushCompanyLogo();
    await saveProject({ id: 'proj-x', name: 'X-1', companyCode: code, payItemCatalog: [], meta: { projectNo: 'X-1' }, createdAt: Date.now() });
    const r = await makeBlankReport(1, await getProject('proj-x'), null); r.date = '2026-10-01'; await saveReport(r);
    await pushAllLocalData(code);
    await setRequireApproval(true);
    return code;
  });
  await Bp.evaluate(async () => { await createAccount({ name: 'Bob', email: 'bob@example.com', password: 'bobpass12' }); });
  await Bp.evaluate(() => joinCompanyRoom('pw-old-1').catch(() => {}));
  const bUid = await Bp.evaluate(() => window.FirebaseCore.auth.currentUser.uid);
  await A.evaluate((uid) => approveTeamMember(uid), bUid);
  await Bp.evaluate(() => checkPendingApproval());
  await A.evaluate(() => inviteTeamMember({ email: 'carol@example.com', role: 'manager', projectIds: null }));

  const res = await A.evaluate(async () => {
    const { newCode } = await changeCompanyPassword('pw-new-1', 'pw-admin-1');
    const { collection, getDocs, doc, getDoc } = await import(FIRESTORE_SDK);
    const db = window.FirebaseCore.db;
    const count = async (sub) => (await getDocs(collection(db, 'companies', newCode, sub))).size;
    const company = (await getDoc(doc(db, 'companies', newCode))).data();
    return {
      newCode,
      projects: await count('projects'), reports: await count('reports'), members: await count('members'), audit: (await count('auditLog')) > 0,
      requireApproval: !!company.requireApproval, logo: !!company.logoUpdatedAt,
      invite: (await listTeam()).invites.map((i) => i.email),
      local: (await getAllProjects()).map((p) => p.companyCode === newCode),
    };
  });
  check('new company has project, report, both members, history', [res.projects, res.reports, res.members, res.audit], [1, 1, 2, true]);
  check('approval setting + logo carried', [res.requireApproval, res.logo], [true, true]);
  check('invite follows', res.invite, ['carol@example.com']);
  check('local data relabeled', res.local, [true]);

  check("Bob's device follows on its next sync", await Bp.evaluate(async (newCode) => { await autoPullCompanyData(true); const room = await getCompanyRoom(); return [room.code === newCode, room.name, (await getAllProjects()).filter((p) => projectInScope(p, room)).map((p) => p.name)]; }, res.newCode), [true, 'PW Co', ['X-1']]);
  check('old password refused', await L.evaluate(() => joinCompanyRoom('pw-old-1').then(() => 'joined', (e) => e.message)), 'This company password has been changed. Ask your admin for the new one.');

  // Logo leak: L joins with the new password after having a stray logo; then leaves.
  check('stray logo cleared on joining a company', await L.evaluate(async () => {
    await saveReportLogo(new Blob(['stray'], { type: 'image/png' }));
    await saveSetting(THEMES_SYNCED_AT_SETTING, Date.now());
    await joinCompanyRoom('pw-new-1');
    await new Promise((r) => setTimeout(r, 2500)); // background logo pull
    const logo = await getReportLogo();
    return logo ? logo.size : null;
  }), 4);
  check('leaving sheds the logo', await L.evaluate(async () => { await leaveCompanyRoom(); return [await getReportLogo(), await getSetting(LOGO_SYNCED_AT_SETTING)]; }), [undefined, undefined]);
  const M = await device('M');
  await M.evaluate(() => createCompanyRoom({ name: 'Plain Co', password: 'plain-pw-1', adminPassword: 'plain-admin-1' }));
  const N = await device('N');
  check('joining a logo-less company drops a stray logo', await N.evaluate(async () => {
    await saveReportLogo(new Blob(['GEC'], { type: 'image/png' }));
    await joinCompanyRoom('plain-pw-1');
    await new Promise((r) => setTimeout(r, 1500));
    return [await getReportLogo(), (await getCompanyRoom()).name];
  }), [undefined, 'Plain Co']);
  check('page errors', errs, []);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
})();
