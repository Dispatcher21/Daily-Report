// Every company feature that talks to Firebase, run under the corrected rules.
const { OUT, launchBrowser, emulatorContext, clearEmulators } = require('../harness');
const B = 'http://127.0.0.1:8126';
let fails = 0;
const step = async (label, page, fn, arg) => {
  try { const r = await page.evaluate(fn, arg); console.log(`PASS ${label}${r !== undefined ? ': ' + JSON.stringify(r) : ''}`); return r; }
  catch (e) { fails++; console.log(`FAIL ${label}: ${e.message.split('\n')[0]}`); return null; }
};
(async () => {
  await clearEmulators();
  const browser = await launchBrowser();
  const errs = [];
  const device = async (n) => { const p = await (await emulatorContext(browser)).newPage(); p.on('pageerror', (e) => errs.push(`${n}: ${e.message}`)); await p.goto(`${B}/settings.html`); await p.waitForTimeout(800); return p; };
  const A = await device('A'), Bp = await device('B');

  await step('create company', A, async () => { await saveUserName('Alice'); await createCompanyRoom({ name: 'Rules Co', password: 'rules-pw-1', adminPassword: 'rules-admin-1' }); });
  await step('create project + report with photo', A, async () => {
    const code = (await getCompanyRoom()).code;
    const project = { id: 'proj-r', name: 'R-1', companyCode: code, payItemCatalog: [], meta: { projectNo: 'R-1', projectName: 'Rules Test' }, createdAt: Date.now() };
    await saveProject(project);
    const report = await makeBlankReport(1, project, null);
    const c = document.createElement('canvas'); c.width = 8; c.height = 8;
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg'));
    report.photos[0] = blob;
    report.date = '2026-10-05';
    await saveReport(report);
    await new Promise((r) => setTimeout(r, 1500));
    return (await getReportsForProject('proj-r')).length;
  });
  await step('rename company', A, () => updateCompanyName('Rules Co 2'));
  await step('change permissions', A, () => updateCompanyPermissions({ membersCanEditProjects: true }));
  await step('save themes', A, () => saveCompanyThemes([{ id: 't1', name: 'Blue', accent: '#123456' }]));
  await step('push user layout', A, async () => pushUserLayout((await getCompanyRoom()).code, 'Alice'));
  await step('create custom setup (pointer doc)', A, () => createCustomRole({ name: 'Crew', password: 'crew-pw-1', permissions: {}, projectIds: ['proj-r'], adminPassword: 'rules-admin-1' }));
  await step('join with company password', Bp, async () => { await saveUserName('Bob'); const r = await joinCompanyRoom('rules-pw-1'); return [r.name, (await getAllProjects()).length]; });
  await step('B fetches the photo', Bp, async () => { const r = (await getReportsForProject('proj-r'))[0]; if (!r) return 'NO REPORT ON B'; const full = await fetchReportMedia(r); return { reports: (await getReportsForProject('proj-r')).length, photo: !!(full && full.photos && full.photos[0]) }; });
  await step('B sync now', Bp, async () => { await syncCompanyRoomNow(); return 'ok'; });
  await step('custom setup login', Bp, async () => { await leaveCompanyRoom(); await joinCompanyRoom('crew-pw-1'); return (await getCompanyRoom()).projectScope; });
  await step('delete custom setup', A, async () => { const roles = await listCustomRoles(); await deleteCustomRole(roles[0].id); return (await listCustomRoles()).length; });
  await step('audit log fetched when opened, not with sync', A, async () => { await autoPullCompanyData(true); const before = (await getAllAuditEntries()).filter((e) => e.fromCompany).length; const added = await fetchCompanyAuditLog(); return before === 0 && added > 0; });
  await step('change company password (moves company)', A, async () => { await changeCompanyPassword('rules-pw-2', 'rules-admin-1'); return (await getCompanyRoom()).name; });
  await step('join with the new password', Bp, async () => { await leaveCompanyRoom(); const r = await joinCompanyRoom('rules-pw-2'); return [r.name, (await getAllProjects()).filter((p) => !p.deleted).length, (await getAllReports()).length]; });
  // Log out from the menu (no account on B): the company and its projects
  // leave the device.
  await step('B has the company before logging out', Bp, async () => [!!(await getCompanyRoom()), (await getAllProjects()).filter((p) => !p.deleted).length > 0]);
  await Bp.goto(`${B}/settings.html`); await Bp.waitForTimeout(1500);
  Bp.once('dialog', (d) => d.accept());
  await Bp.click('#hamburger-btn'); await Bp.click('#hb-logout');
  await Bp.waitForURL(/login\.html/, { timeout: 15000 }).catch(() => {});
  await step('logged out: no company or projects left on B', Bp, async () => [await getCompanyRoom(), (await getAllProjects()).length]);
  await step('delete project', A, async () => { await deleteProject('proj-r'); await new Promise((r) => setTimeout(r, 1000)); return 'ok'; });
  await step('listing all companies is refused', A, async () => { const { collection, getDocs } = await import(FIRESTORE_SDK); try { await getDocs(collection(window.FirebaseCore.db, 'companies')); return 'ALLOWED'; } catch (e) { return e.code; } });
  console.log('page errors:', JSON.stringify(errs));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
})();
