const { OUT, launchBrowser, emulatorContext, clearEmulators } = require('../harness');
const B = 'http://127.0.0.1:8126';
let fails = 0;
const check = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (wanted ${JSON.stringify(want)})`}`); };
// Raw server calls from inside a page, to prove the rules (not the app) block things.
const raw = (p, fn, arg) => p.evaluate(async ({ src, arg }) => {
  const fs = await import(FIRESTORE_SDK); const st = await import(STORAGE_SDK);
  const db = window.FirebaseCore.db, storage = window.FirebaseCore.storage, code = (await getCompanyRoom() || {}).code || window.__code;
  const f = new Function('fs', 'st', 'db', 'storage', 'code', 'arg', `return (async () => { ${src} })();`);
  return f(fs, st, db, storage, code, arg).then((v) => v === undefined ? 'ok' : v, (e) => e.code || e.message);
}, { src: fn, arg });
(async () => {
  await clearEmulators();
  const browser = await launchBrowser();
  const errs = [], alerts = {};
  const device = async (n) => { const p = await (await emulatorContext(browser)).newPage(); p.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) console.log(n, 'CONSOLE', m.text().slice(0, 300)); }); p.on('pageerror', (e) => errs.push(`${n}: ${e.message}`)); p.on('dialog', (d) => { alerts[n] = d.message(); d.accept(); }); await p.goto(`${B}/settings.html`); await p.waitForTimeout(800); return p; };
  const A = await device('A'), Bp = await device('B'), M = await device('M'), L = await device('L');
  const code = await A.evaluate(async () => {
    await saveUserName('Alice');
    await createAccount({ name: 'Alice', email: 'alice@example.com', password: 'alicepass1' });
    await createCompanyRoom({ name: 'Lock Co', password: 'lock-pw-1', adminPassword: 'lock-admin-1' });
    const code = (await getCompanyRoom()).code;
    for (const id of ['p1', 'p2']) {
      await saveProject({ id, name: id.toUpperCase(), companyCode: code, payItemCatalog: [], meta: { projectNo: id }, createdAt: Date.now() });
      const r = await makeBlankReport(1, await getProject(id), null);
      r.id = `rep-${id}`; r.date = '2026-10-01'; r.photos[0] = new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' });
      await saveReport(r);
    }
    await pushAllLocalData(code);
    return code;
  });
  console.log('setup A done');
  const join = async (p, name, email, pw) => p.evaluate(async ({ name, email, pw }) => { await createAccount({ name, email, password: pw }); await joinCompanyRoom('lock-pw-1'); return window.FirebaseCore.auth.currentUser.uid; }, { name, email, pw });
  const bUid = await join(Bp, 'Bob', 'bob@example.com', 'bobpass12');
  console.log('B joined');
  const mUid = await join(M, 'Mia', 'mia@example.com', 'miapass12');
  console.log('M joined');
  await L.evaluate(async () => { await saveUserName('Lee'); await joinCompanyRoom('lock-pw-1'); });
  const D = await device('D');
  await D.evaluate(async () => { await saveUserName('Dee'); await joinCompanyRoom('lock-pw-1'); await unlockCompanyAdmin('lock-admin-1'); });
  console.log('L, D joined');
  await A.evaluate(async ({ bUid, mUid }) => { await updateTeamMember(bUid, { projectIds: ['p1'] }); await updateTeamMember(mUid, { role: 'manager' }); }, { bUid, mUid });

  check('switch off: no-account device still reads', await raw(L, `return (await fs.getDocs(fs.collection(db, 'companies', code, 'reports'))).size;`), 2);
  check('only an admin can turn it on', await raw(Bp, `await fs.updateDoc(fs.doc(db, 'companies', code), { accountsRequired: true });`), 'permission-denied');
  await A.evaluate(() => setAccountsRequired(true));

  // No-account device.
  check('no-account device: reads blocked', await raw(L, `return (await fs.getDocs(fs.collection(db, 'companies', code, 'reports'))).size;`), 'permission-denied');
  await L.evaluate(() => { autoPullCompanyData(true); });
  await L.waitForURL(/login\.html/, { timeout: 10000 });
  check('no-account device: told to sign in, still connected', [/requires everyone to sign in/.test(alerts.L), await L.evaluate(async () => !!(await getCompanyRoom()))], [true, true]);
  const N = await device('N');
  check('new device without account cannot join', await N.evaluate(() => joinCompanyRoom('lock-pw-1').then(() => 'joined', (e) => e.code)), 'account-required');
  check('no-account device signs up and is back in', await L.evaluate(async () => { await createAccount({ name: 'Lee', email: 'lee@example.com', password: 'leepass12' }); await autoPullCompanyData(true); return [(await getMyMembership()).status, (await getAllReports()).length]; }), ['active', 2]);

  // Restricted inspector.
  await Bp.evaluate(() => autoPullCompanyData(true));
  check('B (P1 only) pulls only P1', await Bp.evaluate(async () => [(await getAllProjects()).map((p) => p.id).sort(), (await getAllReports()).map((r) => r.id)]), [['p1'], ['rep-p1']]);
  check('B cannot list all reports', await raw(Bp, `return (await fs.getDocs(fs.collection(db, 'companies', code, 'reports'))).size;`), 'permission-denied');
  check('B cannot open a P2 report', await raw(Bp, `return (await fs.getDoc(fs.doc(db, 'companies', code, 'reports', 'rep-p2'))).exists();`), 'permission-denied');
  if (!process.env.SIMPLE_STORAGE) check('B cannot load a P2 photo', await raw(Bp, `await st.getBytes(st.ref(storage, 'companies/' + code + '/reports/rep-p2/photo-0'));`), 'storage/unauthorized');
  check('B can load a P1 photo', await raw(Bp, `return (await st.getBytes(st.ref(storage, 'companies/' + code + '/reports/rep-p1/photo-0'))).byteLength;`), 3);
  check('B cannot read the activity log', await raw(Bp, `return (await fs.getDocs(fs.collection(db, 'companies', code, 'auditLog'))).size;`), 'permission-denied');
  check('B files a report on P1', await Bp.evaluate(async () => { const r = await makeBlankReport(2, await getProject('p1'), null); r.date = '2026-10-02'; r.photos[0] = new Blob([new Uint8Array([1, 2])], { type: 'image/jpeg' }); await saveReport(r); return confirmReportSyncStatus(await getReport(r.id)); }), 'synced');
  check("B cannot edit Alice's report", await Bp.evaluate(async () => { const r = await getReport('rep-p1'); r.notes = 'changed by Bob'; return confirmReportSyncStatus(r); }), 'failed');
  check('Sync Now finishes the rest and names the refused change', await Bp.evaluate(async () => {
    const mine = await makeBlankReport(3, await getProject('p1'), null); mine.date = '2026-10-03';
    await putReportRaw({ ...mine, createdBy: 'Bob', createdByUid: window.FirebaseCore.auth.currentUser.uid, companyCode: (await getCompanyRoom()).code, pendingPush: true });
    const msg = await syncCompanyRoomNow().then(() => 'no error', (e) => e.message);
    const { doc, getDoc } = await import(FIRESTORE_SDK);
    const landed = (await getDoc(doc(window.FirebaseCore.db, 'companies', (await getCompanyRoom()).code, 'reports', mine.id))).exists();
    // Put Alice's report back the way the server has it.
    await putReportRaw({ ...(await getReport('rep-p1')), notes: '', pendingPush: false });
    return [/Everything else synced, but 1 change/.test(msg), landed];
  }), [true, true]);
  check('B cannot write a P2 report', await raw(Bp, `await fs.setDoc(fs.doc(db, 'companies', code, 'reports', 'sneaky'), { id: 'sneaky', projectId: 'p2', createdByUid: arg });`, bUid), 'permission-denied');
  check('B cannot make himself admin', await raw(Bp, `await fs.updateDoc(fs.doc(db, 'companies', code, 'members', arg), { role: 'admin' });`, bUid), 'permission-denied');
  check('B cannot widen his projects', await raw(Bp, `await fs.updateDoc(fs.doc(db, 'companies', code, 'members', arg), { projectIds: null });`, bUid), 'permission-denied');
  check('admin password unlock refused', await Bp.evaluate(() => unlockCompanyAdmin('lock-admin-1').then(() => 'ok', (e) => e.message)), 'Your company now manages admins on its Team screen. Ask an admin to make you one.');
  check('B cannot change company settings', await raw(Bp, `await fs.updateDoc(fs.doc(db, 'companies', code), { name: 'Hacked' });`), 'permission-denied');
  check('B cannot read the team list', await raw(Bp, `return (await fs.getDocs(fs.collection(db, 'companies', code, 'members'))).size;`), 'permission-denied');

  // Manager.
  await M.evaluate(() => autoPullCompanyData(true));
  check("manager edits Alice's report", await M.evaluate(async () => { const r = await getReport('rep-p2'); r.notes = 'reviewed'; await saveReport(r); return confirmReportSyncStatus(await getReport('rep-p2')); }), 'synced');
  check('manager cannot create projects', await raw(M, `await fs.setDoc(fs.doc(db, 'companies', code, 'projects', 'p9'), { id: 'p9', name: 'P9' });`), 'permission-denied');

  // The role table (Settings > Roles), enforced by the server.
  const commentOn = (id) => `const ref = fs.doc(db, 'companies', code, 'reports', '${id}'); const cur = (await fs.getDoc(ref)).data(); await fs.updateDoc(ref, { comments: [...(cur.comments || []), { id: 'c' + Date.now(), author: 'Bob', text: 'hi', createdAt: Date.now() }], updatedAt: Date.now() });`;
  check('inspector cannot comment on others by default', await raw(Bp, commentOn('rep-p1')), 'permission-denied');
  await A.evaluate(() => updateRolePermission('inspector', 'membersCanApproveReports', true));
  check('roles: inspectors allowed to comment -> can', await raw(Bp, commentOn('rep-p1')), 'ok');
  check('...but still cannot edit the report itself', await raw(Bp, `await fs.updateDoc(fs.doc(db, 'companies', code, 'reports', 'rep-p1'), { notes: 'Bob was here' });`), 'permission-denied');
  await A.evaluate(() => updateRolePermission('manager', 'membersCanEditAnyReport', false));
  check('roles: managers not allowed to edit any report -> blocked', await raw(M, `await fs.updateDoc(fs.doc(db, 'companies', code, 'reports', 'rep-p2'), { notes: 'Mia edit' });`), 'permission-denied');
  await A.evaluate(() => updateRolePermission('manager', 'membersCanEditAnyReport', true));
  await A.evaluate(() => updateRolePermission('manager', 'membersCanCreateProjects', true));
  check('roles: managers allowed to create projects -> can', await raw(M, `await fs.setDoc(fs.doc(db, 'companies', code, 'projects', 'p8'), { id: 'p8', name: 'P8' });`), 'ok');
  check("manager's device picks up the new role settings", await M.evaluate(async () => { await autoPullCompanyData(true); return companyCan('createProjects'); }), true);
  await A.evaluate(() => updateRolePermission('inspector', 'membersCanApproveReports', false));
  // Approving and commenting are separate permissions.
  const approveIt = (id) => `await fs.updateDoc(fs.doc(db, 'companies', code, 'reports', '${id}'), { approvalStatus: 'approved', approvalBy: 'Bob', approvalByUid: 'b', updatedAt: Date.now() });`;
  await A.evaluate(() => updateRolePermission('inspector', 'membersCanCommentReports', true));
  check('comment only: can comment', await raw(Bp, commentOn('rep-p1')), 'ok');
  check('comment only: cannot approve', await raw(Bp, approveIt('rep-p1')), 'permission-denied');
  await A.evaluate(async () => { await updateRolePermission('inspector', 'membersCanCommentReports', false); await updateRolePermission('inspector', 'membersCanApproveReports', true); });
  check('approve only: can approve', await raw(Bp, approveIt('rep-p1')), 'ok');
  check('approve only: cannot comment', await raw(Bp, commentOn('rep-p1')), 'permission-denied');
  check("inspector's device sees the split", await Bp.evaluate(async () => { await autoPullCompanyData(true); return [await companyCan('approveReports'), await companyCan('commentReports')]; }), [true, false]);
  await A.evaluate(() => updateRolePermission('inspector', 'membersCanApproveReports', false));
  // The author can reply on their own report even when inspectors can't edit their own.
  const bobReport = await Bp.evaluate(async () => (await getAllReports()).find((r) => r.createdByUid === window.FirebaseCore.auth.currentUser.uid).id);
  await A.evaluate(() => updateRolePermission('inspector', 'membersCanEditOwnReports', false));
  check('owner can still reply on own report', await raw(Bp, commentOn(bobReport)), 'ok');
  check('...but not edit it', await raw(Bp, `await fs.updateDoc(fs.doc(db, 'companies', code, 'reports', '${bobReport}'), { notes: 'edit' });`), 'permission-denied');
  await A.evaluate(() => updateRolePermission('inspector', 'membersCanEditOwnReports', true));

  // Activity log is append-only.
  check('activity log entry cannot be edited', await raw(A, `const d = (await fs.getDocs(fs.collection(db, 'companies', code, 'auditLog'))).docs[0]; await fs.updateDoc(d.ref, { userName: 'Someone Else' });`), 'permission-denied');
  check('activity log entry cannot be deleted', await raw(A, `const d = (await fs.getDocs(fs.collection(db, 'companies', code, 'auditLog'))).docs[0]; await fs.deleteDoc(d.ref);`), 'permission-denied');

  // Project access changes.
  await A.evaluate((uid) => updateTeamMember(uid, { projectIds: ['p1', 'p2'] }), bUid);
  await Bp.evaluate(() => autoPullCompanyData(true));
  check('B given P2: older P2 reports arrive', await Bp.evaluate(async () => (await getAllReports()).map((r) => r.id).filter((id) => id.startsWith('rep-')).sort()), ['rep-p1', 'rep-p2']);
  await A.evaluate((uid) => updateTeamMember(uid, { projectIds: ['p2'] }), bUid);
  check('B loses P1: its copies leave B\'s device', await Bp.evaluate(async () => { await autoPullCompanyData(true); return [(await getAllProjects()).map((p) => p.id).sort(), (await getAllReports()).map((r) => r.projectId).sort()]; }), [['p2'], ['p2']]);

  // Turned off: blocked by the server right away.
  await A.evaluate((uid) => updateTeamMember(uid, { status: 'disabled' }), mUid);
  check('turned-off manager blocked immediately', await raw(M, `return (await fs.getDocs(fs.collection(db, 'companies', code, 'reports'))).size;`), 'permission-denied');

  // Joining while required.
  const C = await device('C');
  check('new account joins with the password', await C.evaluate(async () => { await createAccount({ name: 'Cal', email: 'cal@example.com', password: 'calpass12' }); await joinCompanyRoom('lock-pw-1'); return [(await getMyMembership()).role, (await getAllReports()).length]; }), ['inspector', 4]);
  const E = await device('E');
  check('nobody joins as admin by themselves', await E.evaluate(async (code) => {
    await createAccount({ name: 'Eve', email: 'eve@example.com', password: 'evepass12' });
    const { doc, setDoc } = await import(FIRESTORE_SDK);
    const uid = window.FirebaseCore.auth.currentUser.uid;
    return setDoc(doc(window.FirebaseCore.db, 'companies', code, 'members', uid), { uid, role: 'admin', status: 'active', projectIds: null }).then(() => 'ALLOWED', (e) => e.code);
  }, code), 'permission-denied');
  check('admin-password device (from before) signs up as an inspector', await D.evaluate(async () => {
    await createAccount({ name: 'Dee', email: 'dee@example.com', password: 'deepass12' });
    const room = await getCompanyRoom();
    return [(await getMyMembership()).role, room.isAdmin];
  }), ['inspector', false]);

  // Switch off again: password-only access is back.
  await A.evaluate(() => setAccountsRequired(false));
  check('switch off: no-account access is back', await raw(N, `return (await fs.getDocs(fs.collection(db, 'companies', arg, 'reports'))).size;`, code), 4);
  check('page errors', errs, []);
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
})();
