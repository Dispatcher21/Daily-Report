const { OUT, launchBrowser, emulatorContext, clearEmulators } = require('../harness');
const B = 'http://127.0.0.1:8126';
let fails = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (wanted ${JSON.stringify(want)})`}`); };
const verifyEmail = async (uid) => fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/daily-reports-test/accounts:update', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer owner' }, body: JSON.stringify({ localId: uid, emailVerified: true }) });
const err = (p) => p.then(() => 'ok', (e) => e.code || e.message);
(async () => {
  await clearEmulators();
  const browser = await launchBrowser();
  const errs = [];
  const device = async (n) => { const p = await (await emulatorContext(browser)).newPage(); p.on('pageerror', (e) => errs.push(`${n}: ${e.message}`)); await p.goto(`${B}/settings.html`); await p.waitForTimeout(800); return p; };
  const A = await device('A'), Bp = await device('B'), C = await device('C');
  const code = await A.evaluate(async () => {
    await saveUserName('Alice');
    await createCompanyRoom({ name: 'Team Co', password: 'team-pw-1', adminPassword: 'team-admin-1' });
    const code = (await getCompanyRoom()).code;
    for (const id of ['p1', 'p2']) await saveProject({ id, name: id.toUpperCase(), companyCode: code, payItemCatalog: [], meta: { projectNo: id }, createdAt: Date.now() });
    await createAccount({ name: 'Alice', email: 'alice@example.com', password: 'alicepass1' });
    await setRequireApproval(true);
    return code;
  });

  // Approval flow.
  const bUid = await Bp.evaluate(async () => { await createAccount({ name: 'Bob', email: 'bob@example.com', password: 'bobpass12' }); return window.FirebaseCore.auth.currentUser.uid; });
  check('B join waits for approval', await Bp.evaluate(() => joinCompanyRoom('team-pw-1').then(() => 'joined', (e) => e.code)), 'pending-approval');
  check('B not connected yet', await Bp.evaluate(async () => [await getCompanyRoom(), (await checkPendingApproval()).status]), [null, 'pending']);
  check('A sees B waiting', await A.evaluate(async () => (await listTeam()).members.filter((m) => m.status === 'pending').map((m) => m.email)), ['bob@example.com']);
  await A.evaluate((uid) => approveTeamMember(uid), bUid);
  check('B approved -> connected', await Bp.evaluate(async () => [(await checkPendingApproval()).status, (await getCompanyRoom()).name]), ['active', 'Team Co']);
  await A.evaluate((uid) => updateTeamMember(uid, { role: 'manager', projectIds: ['p1'] }), bUid);
  await Bp.evaluate(() => autoPullCompanyData(true));
  check('B manager, P1 only', await Bp.evaluate(async () => { const room = await getCompanyRoom(); return [await companyCan('approveReports'), (await getAllProjects()).filter((p) => projectInScope(p, room)).map((p) => p.id)]; }), [true, ['p1']]);

  // Rules: a non-admin can't invite or read others' invites.
  await A.evaluate(() => inviteTeamMember({ email: 'Carol@Example.com', role: 'inspector', projectIds: ['p2'] }));
  check('B (not admin) cannot create an invite', await Bp.evaluate(async (code) => { const { doc, setDoc } = await import(FIRESTORE_SDK); return setDoc(doc(window.FirebaseCore.db, 'invites', 'x@example.com'), { companyCode: code, role: 'admin' }).then(() => 'ALLOWED', (e) => e.code); }, code), 'permission-denied');
  check("B cannot read Carol's invite", await Bp.evaluate(async () => { const { doc, getDoc } = await import(FIRESTORE_SDK); return getDoc(doc(window.FirebaseCore.db, 'invites', 'carol@example.com')).then(() => 'ALLOWED', (e) => e.code); }), 'permission-denied');
  check('A lists the invite', await A.evaluate(async () => (await listTeam()).invites.map((i) => [i.email, i.role, i.projectIds])), [['carol@example.com', 'inspector', ['p2']]]);

  // Invite flow.
  const cUid = await C.evaluate(async () => { await createAccount({ name: 'Carol', email: 'carol@example.com', password: 'carolpass1' }); return window.FirebaseCore.auth.currentUser.uid; });
  check('Carol sees her invite', await C.evaluate(async () => (await getMyInvite()).companyName), 'Team Co');
  check('pre-approval cannot grant admin', await A.evaluate(() => inviteTeamMember({ email: 'x@example.com', role: 'admin', projectIds: null }).then(() => 'ok', (e) => e.message)), 'A pre-approved email can be an Inspector or Manager. Make someone an Admin from the Team list once they join.');
  check('joins with P2 only, no verification needed', await C.evaluate(async () => { await acceptMyInvite(); const room = await getCompanyRoom(); return [room.name, (await getAllProjects()).filter((p) => projectInScope(p, room)).map((p) => p.id), await getMyInvite()]; }), ['Team Co', ['p2'], null]);

  // Guard rails.
  check('only admin cannot demote self', await A.evaluate((uid) => updateTeamMember(uid, { role: 'inspector' }).then(() => 'ok', (e) => e.message), await A.evaluate(() => window.FirebaseCore.auth.currentUser.uid)), "You're the only admin -- make someone else an admin first.");
  check('B (not admin) cannot use team tools', await Bp.evaluate(() => listTeam().then(() => 'ok', (e) => e.message)), 'Only an admin can manage the team.');

  // Turn B off: B's device disconnects.
  await A.evaluate((uid) => updateTeamMember(uid, { status: 'disabled' }), bUid);
  let bAlert = null;
  Bp.on('dialog', (d) => { bAlert = d.message(); d.accept(); });
  await Bp.evaluate(() => { autoPullCompanyData(true); });
  await Bp.waitForURL(/index\.html/, { timeout: 15000 });
  await Bp.waitForTimeout(800);
  check('disabled B disconnected, told why, sent home', [await Bp.evaluate(() => getCompanyRoom()), bAlert], [null, "An admin turned off your access to Team Co. This device has left the company. Anything that hadn't uploaded yet is still saved here."]);
  check('disabled B cannot rejoin by password', await Bp.evaluate(() => joinCompanyRoom('team-pw-1').then(() => 'joined', (e) => e.message)), 'Your access to this company has been turned off. Ask your admin.');

  // Sign-out cleanup on Carol's device: keeps the unsent report only.
  const kept = await C.evaluate(async () => {
    const project = (await getAllProjects()).find((p) => p.id === 'p2');
    const sent = await makeBlankReport(1, project, null); sent.date = '2026-10-01'; await saveReport(sent);
    const unsent = await makeBlankReport(2, project, null); unsent.date = '2026-10-02'; await saveReport(unsent);
    await new Promise((r) => setTimeout(r, 1500));
    await putReportRaw({ ...(await getReport(unsent.id)), pendingPush: true }); // as if its upload never landed
    await signOutAccount();
    return { reports: (await getAllReports({ includeDeleted: true })).map((r) => r.reportNo), projects: (await getAllProjects()).map((p) => p.id), createdByUid: !!unsent.createdByUid };
  });
  check('sign-out keeps only the unsent report (and its project)', [kept.reports, kept.projects], [[2], ['p2']]);
  check('reports carry the account id', kept.createdByUid, true);
  check('page errors', errs, []);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
})();
