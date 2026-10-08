// The Summary and Photos page: photos 7-10 sync between devices (and
// survive a teammate on an older version saving the report), and the
// printed report grows a third page only when it's needed.
const { launchBrowser, emulatorContext, clearEmulators } = require('../harness');
const B = 'http://127.0.0.1:8126';
let fails = 0;
const step = async (label, page, fn, arg, expect) => {
  try {
    const r = await page.evaluate(fn, arg);
    const ok = expect === undefined || JSON.stringify(r) === JSON.stringify(expect);
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(r)}${ok ? '' : ' (expected ' + JSON.stringify(expect) + ')'}`);
    return r;
  } catch (e) { fails++; console.log(`FAIL ${label}: ${e.message.split('\n')[0]}`); return null; }
};
(async () => {
  await clearEmulators();
  const browser = await launchBrowser();
  const errs = [];
  const device = async (n) => { const p = await (await emulatorContext(browser)).newPage(); p.on('pageerror', (e) => errs.push(`${n}: ${e.message}`)); await p.goto(`${B}/settings.html`); await p.waitForTimeout(800); return p; };
  const A = await device('A'), Bp = await device('B');

  await step('create company and project', A, async () => {
    await saveUserName('Alice');
    await createCompanyRoom({ name: 'Pages Co', password: 'pages-pw-1', adminPassword: 'pages-admin-1' });
    const code = (await getCompanyRoom()).code;
    await saveProject({ id: 'proj-p', name: 'P-1', companyCode: code, payItemCatalog: [], meta: { projectNo: 'P-1', projectName: 'Pages Test' }, createdAt: Date.now() });
    return 'ok';
  });

  await step('a new report has 10 photo slots', A, async () => {
    const r = await makeBlankReport(1, await getProject('proj-p'), null);
    return [r.photos.length, r.photosFetched.length];
  }, undefined, [10, 10]);

  await step('an older 6-slot report is padded to 10', A, () => {
    const r = normalizeReport({ photos: [null, null, null, null, null, null], photosFetched: [true, true, true, true, true, false], equipmentRows: [] });
    return [r.photos.length, r.photosFetched.length, r.photosFetched[5], r.photosFetched[9]];
  }, undefined, [10, 10, false, true]);

  await step('save report 1 (photos 1 and 9) and report 2 (photo 1 only)', A, async () => {
    const jpeg = async (color) => { const c = document.createElement('canvas'); c.width = 8; c.height = 8; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 8, 8); return new Promise((r) => c.toBlob(r, 'image/jpeg')); };
    const project = await getProject('proj-p');
    const r1 = await makeBlankReport(1, project, null);
    r1.id = 'rep-1'; r1.date = '2026-10-06';
    r1.photos[0] = await jpeg('#f00');
    r1.photos[8] = await jpeg('#00f');
    await saveReport(r1);
    const r2 = await makeBlankReport(2, project, null);
    r2.id = 'rep-2'; r2.date = '2026-10-07';
    r2.photos[0] = await jpeg('#0f0');
    await saveReport(r2);
    return [await confirmReportPushed(await getReport('rep-1')), await confirmReportPushed(await getReport('rep-2'))];
  }, undefined, [true, true]);

  await step('report docs: photoSlots stays 6 long, extra slots only where used', A, async () => {
    const { doc, getDoc } = await import(FIRESTORE_SDK);
    const code = (await getCompanyRoom()).code;
    const d1 = (await getDoc(doc(window.FirebaseCore.db, 'companies', code, 'reports', 'rep-1'))).data();
    const d2 = (await getDoc(doc(window.FirebaseCore.db, 'companies', code, 'reports', 'rep-2'))).data();
    return [d1.photoSlots.length, d1.extraPhotoSlots, 'extraPhotoSlots' in d2];
  }, undefined, [6, [false, false, true, false], false]);

  const bWait = await step('B joins', Bp, async () => { await saveUserName('Bob'); return joinCompanyRoom('pages-pw-1').then(() => 'joined', (e) => e.code); });
  const bUid = await Bp.evaluate(() => window.FirebaseCore.auth.currentUser.uid);
  if (bWait === 'pending-approval') {
    await step('admin approves B', A, async (uid) => { await approveTeamMember(uid); await updateTeamMember(uid, { projectIds: null }); return 'ok'; }, bUid);
    await step('B is in', Bp, async () => (await checkPendingApproval()).status);
  }

  await step('B pulls report 1 with photo 9 still to download', Bp, async () => {
    await autoPullCompanyData(true);
    const r = await getReport('rep-1');
    return [r.photos.length, r.photosFetched[0], r.photosFetched[8], r.photosFetched[9]];
  }, undefined, [10, false, false, true]);

  await step('B downloads photo 9', Bp, async () => {
    const full = await fetchReportMedia(await getReport('rep-1'));
    return [!!full.photos[0], !!full.photos[8], !!full.photos[9]];
  }, undefined, [true, true, false]);

  // An older app version rewrites photoSlots as 6 entries and carries every
  // other field it pulled (extraPhotoSlots included) straight back.
  await step('an older version saving the report keeps photo 9', A, async () => {
    const { doc, getDoc, setDoc } = await import(FIRESTORE_SDK);
    const code = (await getCompanyRoom()).code;
    const ref = doc(window.FirebaseCore.db, 'companies', code, 'reports', 'rep-1');
    const data = (await getDoc(ref)).data();
    await setDoc(ref, { ...data, photoSlots: data.photoSlots.slice(0, 6), workSummary: 'Edited on an older version', updatedAt: Date.now() });
    return 'ok';
  });
  await step('B still sees photo 9 after the older version saved', Bp, async () => {
    await autoPullCompanyData(true);
    const r = await getReport('rep-1');
    return [r.workSummary, !!r.photos[8] || r.photosFetched[8] === false];
  }, undefined, ['Edited on an older version', true]);

  await step('A removes photo 9 and it goes for everyone', A, async () => {
    const r = await fetchReportMedia(await getReport('rep-1'));
    r.photos[8] = null; r.photosFetched[8] = true;
    await saveReport(r);
    return confirmReportPushed(await getReport('rep-1'));
  }, undefined, true);
  await step('B no longer has photo 9', Bp, async () => {
    await autoPullCompanyData(true);
    const r = await getReport('rep-1');
    return [!!r.photos[8], r.photosFetched[8]];
  }, undefined, [false, true]);

  // ---------- Printed pages ----------
  await A.addStyleTag({ url: `${B}/print-sheet.css` });
  await A.addScriptTag({ url: `${B}/render-report.js` });
  // Each case: which sheets print, in order (1 work report, 2 photo log,
  // 3 Summary and Photos), and the photo numbers each later page shows.
  await step('which pages print, and in what order', A, async () => {
    const layout = await loadPrintLayout();
    const jpeg = await new Promise((r) => { const c = document.createElement('canvas'); c.width = 40; c.height = 30; c.toBlob(r, 'image/jpeg'); });
    const sandbox = document.createElement('div');
    sandbox.style.cssText = 'position:fixed; top:0; left:-20000px;';
    document.body.appendChild(sandbox);
    const project = await getProject('proj-p');
    const para = 'Placed Type B base course from Sta. 12+00 to Sta. 18+50, left lane; compaction verified at three locations per lot. ';
    const items = Array.from({ length: 16 }, (_, i) => ({ itemNumber: `40${i}-01`, description: `Item ${i}`, qty: 10 + i, unit: 'TON', startStation: '10+00', endStation: '12+00' }));
    const photos = (...slots) => Array.from({ length: 10 }, (_, i) => (slots.includes(i + 1) ? jpeg : null));
    const make = async (fields) => Object.assign(await makeBlankReport(1, project, null), fields);
    const run = async (fields) => {
      sandbox.innerHTML = '';
      const pages = renderReportPages(sandbox, layout, await make(fields), null);
      const text = (el) => el.textContent.replace(/\s+/g, ' ');
      const nums = (el) => [...text(el).matchAll(/PHOTO NO\. (\d+)/g)].map((m) => Number(m[1])).filter((n, i, a) => a.indexOf(n) === i);
      return {
        sheets: pages.map((p) => p.sheet),
        photoNos: pages.slice(1).map((p) => nums(p.el).length === 6 && p.el.querySelectorAll('img').length === 0 ? 'blank log' : nums(p.el)),
        note: (pages[0].el.querySelector('.rr-sbox-note') || {}).textContent || '',
        overflow: pages.map((p) => !!p.el.querySelector('.rr-sbox[data-overflow]')),
        sameSize: pages.every((p) => p.geom.pageH === pages[1].geom.pageH || p.sheet === 1),
        text: pages.slice(1).map((p) => text(p.el)),
      };
    };
    const plain = await run({ workSummary: para, photos: photos(1, 2, 3, 4, 5, 6) });
    const gap = await run({ workSummary: para, photos: photos(1, 3) });
    const lateSlot = await run({ workSummary: para, photos: photos(2, 10) });
    const eight = await run({ workSummary: para, photos: photos(1, 2, 3, 4, 5, 6, 7, 8) });
    const longFew = await run({ workSummary: para.repeat(3), payItems: items, photos: photos(1, 2, 9) });
    const longMany = await run({ workSummary: para.repeat(60), payItems: items.slice(0, 3), photos: photos(1, 2, 3, 4, 5, 6, 7) });
    // Too much even for the extra page: its box flags itself, which is what
    // the report editor's warning looks for.
    const tooLong = await run({ workSummary: para.repeat(200) });
    sandbox.remove();
    return {
      plain: [plain.sheets, plain.note],
      gap: [gap.sheets, gap.photoNos],
      lateSlot: [lateSlot.sheets, lateSlot.photoNos],
      eight: [eight.sheets, eight.photoNos, eight.sameSize],
      longFew: [longFew.sheets, longFew.photoNos, longFew.note, longFew.overflow, longFew.text[0].includes('Item 15')],
      longMany: [longMany.sheets, longMany.photoNos, longMany.note, longMany.overflow, longMany.text[0].includes('Item 2')],
      tooLong: [tooLong.sheets, tooLong.overflow],
    };
  }, undefined, {
    plain: [[1, 2], ''],
    gap: [[1, 2], [[1, 2, 3, 4, 5, 6]]],
    lateSlot: [[1, 2], [[2, 10]]],
    eight: [[1, 2, 3], [[1, 2, 3, 4, 5, 6], [7, 8]], true],
    longFew: [[1, 3], [[1, 2, 9]], '(Continued on page 2)', [false, false], true],
    longMany: [[1, 3, 2], [[1, 2, 3, 4], [5, 6, 7]], '(Continued on page 2)', [false, false, false], true],
    tooLong: [[1, 3], [false, true]],
  });

  console.log('page errors:', JSON.stringify(errs));
  if (errs.length) fails++;
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  await browser.close();
})();
