// Example data for tutorial mode (see tutorial.html). Only ever loaded by
// tutorial.html, after it has switched this tab into tutorial mode, so
// every save below lands in the separate tutorial database -- never the
// real one. Dates are relative to today so the example always looks
// current: about four weeks of weekday reports ending today.

const TUTORIAL_USER = 'Tutorial User';
const TUTORIAL_COMPANY = { code: 'TUTORIAL', name: 'Example Construction Co.' };

// Each report's day: what was worked on, which pay items were logged, and
// any special handling (weather day, no work day, approval/comments).
const TUTORIAL_DAYS = [
  { activity: 'Mobilization, clearing', summary: 'Contractor mobilized equipment and set up the staging area at Riverside Dr & 4th St. Clearing and grubbing along the north shoulder, Sta. 10+00 to 14+50.', pay: [['201-01', 4500]], weather: 'Sunny', hi: 84, lo: 66, photos: ['Staging area set up', 'Clearing north shoulder'] },
  { activity: 'Clearing, traffic control setup', summary: 'Finished clearing to Sta. 18+00. Traffic control crew installed advance warning signs and the lane closure taper per the TCP.', pay: [['201-01', 6000], ['713-01', 9500]], weather: 'Sunny', hi: 86, lo: 68, photos: ['Lane closure taper installed'] },
  { activity: 'Pavement removal', summary: 'Saw-cut and removed existing asphalt pavement, Sta. 10+00 to 12+75. Hauled millings off site.', pay: [['202-01', 310]], weather: 'Partly cloudy', hi: 85, lo: 69, photos: ['Saw-cutting existing pavement', 'Pavement removal'] },
  { activity: 'Pavement removal', summary: 'Continued pavement removal to Sta. 15+40. Located an unmarked water service at Sta. 14+10; contractor exposed it by hand and notified the utility.', pay: [['202-01', 340], ['201-01', 4500]], weather: 'Partly cloudy', hi: 83, lo: 67, photos: ['Unmarked water service exposed'] },
  { activity: '', notes: 'WEATHER DAY', weather: 'Thunderstorms', hi: 78, lo: 70 },
  { activity: 'Drain pipe installation', summary: 'Began trenching for the 24" storm drain at Sta. 10+00. Installed 96 LF of pipe and bedding; trench box in use.', pay: [['701-03', 96]], weather: 'Overcast', hi: 80, lo: 68, photos: ['Trench box in place', 'Pipe bedding', '24-inch pipe laid'], approval: 'approved' },
  { activity: 'Drain pipe installation', summary: 'Installed 128 LF of 24" pipe, Sta. 10+96 to 12+24. Backfilled and compacted in 8" lifts; density tests passed.', pay: [['701-03', 128]], weather: 'Sunny', hi: 87, lo: 70, photos: ['Backfill and compaction'], approval: 'approved' },
  { activity: 'Drain pipe, catch basin', summary: 'Installed 110 LF of pipe and set Catch Basin CB-1 at Sta. 12+30.', pay: [['701-03', 110], ['702-01', 1]], weather: 'Sunny', hi: 88, lo: 71, photos: ['Catch basin CB-1 set', 'Pipe connection at CB-1'], approval: 'approved', traffic: 'ATTENTION_REQUIRED', trafficNote: 'Two drums knocked down overnight near Sta. 11+00; replaced by 7:30 AM.' },
  { activity: 'Drain pipe installation', summary: 'Installed 140 LF of pipe to Sta. 13+80. Inspector verified grade with a laser at 50 ft intervals.', pay: [['701-03', 140]], weather: 'Partly cloudy', hi: 86, lo: 70, photos: ['Checking pipe grade'], approval: 'approved' },
  { activity: '', notes: 'NO WORK DAY - contractor waiting on catch basin delivery', weather: 'Sunny', hi: 85, lo: 69 },
  { activity: 'Catch basins', summary: 'Set Catch Basins CB-2 and CB-3 at Sta. 14+20 and 15+60. Grouted pipe connections.', pay: [['702-01', 2]], weather: 'Overcast', hi: 82, lo: 70, photos: ['Catch basin CB-2', 'Grouting pipe connection'], approval: 'changes_requested', comment: { author: 'Jordan Lee, P.E.', text: 'Please add the catch basin rim elevations to this report before I approve it.' } },
  { activity: 'Drain pipe installation', summary: 'Installed 152 LF of pipe, Sta. 15+60 to 17+12.', pay: [['701-03', 152]], weather: 'Sunny', hi: 89, lo: 72, photos: ['Pipe installation, Sta. 16+00'], approval: 'approved' },
  { activity: 'Drain pipe, catch basin', summary: 'Installed 120 LF of pipe and set Catch Basin CB-4 at Sta. 18+30. Storm drain mainline complete to Sta. 18+30.', pay: [['701-03', 120], ['702-01', 1], ['713-01', 6000]], weather: 'Sunny', hi: 90, lo: 73, photos: ['Catch basin CB-4', 'Mainline complete'], approval: 'approved' },
  { activity: 'Base course', summary: 'Placed and compacted crushed stone base, Sta. 10+00 to 13+50.', pay: [['202-01', 280]], weather: 'Partly cloudy', hi: 87, lo: 71, photos: ['Placing stone base'], pinComment: { author: 'Jordan Lee, P.E.', text: 'Is this the area where the water service was found? Please confirm it was reconnected.', page: 0, x: 0.62, y: 0.38 } },
  { activity: 'Base course', summary: 'Placed and compacted stone base, Sta. 13+50 to 18+00. Proof-rolled; one soft spot at Sta. 16+20 undercut and replaced.', pay: [['202-01', 300]], weather: 'Sunny', hi: 88, lo: 72, photos: ['Proof-rolling base', 'Soft spot undercut'] },
  { activity: 'Asphalt paving', summary: 'Placed first lift of asphalt, Sta. 10+00 to 14+00. Mat temperature and density checked every 200 ft.', pay: [['502-01', 118]], weather: 'Sunny', hi: 89, lo: 73, photos: ['Paving first lift', 'Checking mat temperature'] },
  { activity: 'Asphalt paving', summary: 'Placed first lift of asphalt, Sta. 14+00 to 18+30.', pay: [['502-01', 126], ['713-01', 4000]], weather: 'Partly cloudy', hi: 87, lo: 72, photos: ['Paving, Sta. 16+00'] },
  { activity: 'Asphalt paving', summary: 'Placed surface course, Sta. 10+00 to 12+50. Rolling pattern established; joints tack-coated.', pay: [['502-01', 92]], weather: 'Sunny', hi: 88, lo: 71, photos: ['Surface course', 'Rolling the mat'] },
  { activity: 'Asphalt paving, cleanup', summary: 'Placed surface course to Sta. 15+00. Swept and cleaned the work zone at end of shift.', pay: [['502-01', 104]], weather: 'Overcast', hi: 84, lo: 70, photos: ['Surface course, Sta. 14+00'] },
];

// A simple drawn "site photo" so the example reports have real photo
// pages without shipping image files: sky, ground, a work zone, and a
// caption. Returned as a JPEG blob, same as a photo taken in the app.
function tutorialPhoto(caption, seed) {
  const c = document.createElement('canvas');
  c.width = 800; c.height = 600;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 330);
  sky.addColorStop(0, `hsl(${205 + (seed % 3) * 4}, 60%, 62%)`);
  sky.addColorStop(1, 'hsl(200, 50%, 86%)');
  g.fillStyle = sky; g.fillRect(0, 0, 800, 330);
  g.fillStyle = `hsl(${30 + (seed % 4) * 5}, 28%, ${38 + (seed % 3) * 4}%)`;
  g.fillRect(0, 330, 800, 270);
  g.fillStyle = '#3d3f42';
  g.beginPath(); g.moveTo(250, 600); g.lineTo(390, 330); g.lineTo(450, 330); g.lineTo(640, 600); g.fill();
  g.fillStyle = '#e8e4d8';
  for (let y = 360; y < 600; y += 60) g.fillRect(415, y, 8, 26);
  g.fillStyle = '#f07a1a';
  [[170, 470], [215, 410], [600, 470], [560, 410]].forEach(([x, y]) => {
    g.beginPath(); g.moveTo(x, y - 46); g.lineTo(x - 16, y); g.lineTo(x + 16, y); g.fill();
  });
  g.fillStyle = '#f2c230';
  g.fillRect(90 + (seed % 5) * 40, 300, 120, 50);
  g.fillRect(110 + (seed % 5) * 40, 270, 50, 32);
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.fillRect(0, 530, 800, 70);
  g.fillStyle = '#fff';
  g.font = 'bold 30px sans-serif';
  g.fillText(caption, 24, 575);
  g.font = '18px sans-serif';
  g.fillText('Example photo', 650, 30);
  return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.8));
}

function tutorialIsoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The last `count` weekdays ending today, oldest first.
function tutorialWeekdays(count) {
  const out = [];
  for (let back = 0; out.length < count; back++) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    if (d.getDay() !== 0 && d.getDay() !== 6) out.unshift(tutorialIsoDaysAgo(back));
  }
  return out;
}

async function seedTutorialData(onProgress) {
  const progress = onProgress || (() => {});
  await saveUserName(TUTORIAL_USER);
  await saveSetting('companyRoomCode', TUTORIAL_COMPANY.code);
  await saveSetting('companyRoomName', TUTORIAL_COMPANY.name);
  await saveSetting('companyRoomIsAdmin', true);
  // Per-person dashboard settings that would otherwise be fetched from the
  // company's cloud record on first visit (sync is off in tutorial mode).
  await saveSetting(managerDashboardExcludedSettingKey(TUTORIAL_USER), []);

  const dates = tutorialWeekdays(TUTORIAL_DAYS.length);
  const catalog = [
    { itemNumber: '201-01', description: 'Clearing and Grubbing', unit: 'LS', plannedQty: 1, unitPrice: 15000 },
    { itemNumber: '202-01', description: 'Removal of Existing Pavement', unit: 'SY', plannedQty: 2400, unitPrice: 12.5 },
    { itemNumber: '502-01', description: 'Asphalt Concrete', unit: 'TON', plannedQty: 650, unitPrice: 145 },
    { itemNumber: '701-03', description: '24" Storm Drain Pipe', unit: 'LF', plannedQty: 1800, unitPrice: 95 },
    { itemNumber: '702-01', description: 'Catch Basin', unit: 'EA', plannedQty: 14, unitPrice: 4200 },
    { itemNumber: '713-01', description: 'Temporary Traffic Control', unit: 'LS', plannedQty: 1, unitPrice: 38000 },
  ];
  const project = {
    id: crypto.randomUUID(),
    companyCode: TUTORIAL_COMPANY.code,
    name: 'DEMO-101 - Riverside Drive Drainage',
    icon: '\u{1F6A7}',
    meta: {
      projectNo: 'DEMO-101',
      projectName: 'Riverside Drive Drainage Improvements',
      ntpDate: dates[0],
      contractLength: '120',
      representative: TUTORIAL_USER,
      peName: 'Jordan Lee, P.E.',
      activity: '', notes: '', workSummaryHeader: '', trafficControlNote: '', workSummary: '',
      controllingItem: '', commentsOnTime: '', controllingItemTimeFrom: '', controllingItemTimeTo: '',
      workingConditions: '', trafficControlSelect: 'IN_PLACE', workBegin: '7:00 AM', workEnd: '3:30 PM',
      weatherDesc: '', tempHigh: '', tempLow: '',
    },
    defaultContractors: ['Delta Civil Constructors', 'Gulf Coast Paving', 'Bayou Traffic Control'],
    defaultEquipmentLabels: [],
    payItemCatalog: catalog,
    billingEstimates: [],
    requiredFields: [], hiddenFields: [], fieldOrder: [],
    backgroundImage: null, backgroundImageFetched: true,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  await saveProject(project);
  await saveSetting(managedProjectsSettingKey(TUTORIAL_USER), [project.id]);

  const byItem = new Map(catalog.map((it) => [it.itemNumber, it]));
  let previous = null;
  let photoSeed = 0;
  for (let i = 0; i < TUTORIAL_DAYS.length; i++) {
    const day = TUTORIAL_DAYS[i];
    progress(`Writing example report ${i + 1} of ${TUTORIAL_DAYS.length}…`);
    const report = await makeBlankReport(i + 1, project, previous);
    report.date = dates[i];
    report.activity = day.activity || '';
    report.notes = day.notes || '';
    report.weatherDesc = day.weather;
    report.tempHigh = String(day.hi);
    report.tempLow = String(day.lo);
    report.workBegin = '7:00 AM';
    report.workEnd = '3:30 PM';
    const working = !day.notes;
    report.hours = working ? '8' : '';
    report.inspectors = [{ name: TUTORIAL_USER, hours: working ? '8' : '', timeEntries: [{ start: working ? '07:00' : '', end: working ? '15:30' : '' }] }];
    report.trafficControlSelect = working ? (day.traffic || 'IN_PLACE') : null;
    report.commentsOnTime = day.trafficNote || '';
    report.workSummaryHeader = day.activity || '';
    report.workSummary = day.summary || '';
    if (working) {
      // Crew counts in the Contractors Force & Equipment table: one column
      // per contractor, one row per role/equipment label.
      const crew = { Superintendent: ['1'], Foreman: ['1', day.pay.some(([n]) => n === '502-01') ? '1' : ''], Operators: ['3', day.pay.some(([n]) => n === '502-01') ? '4' : ''], Laborers: ['5', ''], 'Pickup truck': ['2', '', '1'], 'Attenuator truck': ['', '', '1'] };
      report.equipmentRows.forEach((row) => {
        const counts = crew[row.label];
        if (counts) counts.forEach((v, col) => { row.qty[col] = v; });
      });
      day.pay.forEach(([itemNumber, qty], row) => {
        const cat = byItem.get(itemNumber);
        Object.assign(report.payItems[row], { itemNumber, description: cat.description, unit: cat.unit, qty: String(qty) });
      });
    }
    for (let p = 0; p < (day.photos || []).length; p++) {
      report.photos[p] = await tutorialPhoto(day.photos[p], photoSeed++);
    }
    if (day.approval) report.approvalStatus = day.approval;
    const comments = [];
    if (day.comment) comments.push({ id: crypto.randomUUID(), author: day.comment.author, text: day.comment.text, createdAt: Date.now() - 86400000 });
    if (day.pinComment) {
      const c = day.pinComment;
      comments.push({ id: crypto.randomUUID(), author: c.author, text: c.text, createdAt: Date.now() - 3600000, pin: { page: c.page, x: c.x, y: c.y } });
    }
    if (comments.length) report.comments = comments;
    await saveReport(report);
    previous = report;
  }

  progress('Adding a Pay App…');
  const fresh = await getProject(project.id);
  fresh.billingEstimates = [{
    id: crypto.randomUUID(), estimateNo: '1', date: dates[9], note: 'Example Pay App',
    itemTotals: { '201-01': 15000, '202-01': 650, '701-03': 474, '702-01': 1, '713-01': 9500 },
    approvalStatus: 'approved', updatedAt: Date.now(),
  }, {
    // Sent back by the engineer, with a comment -- so the tutorial's Pay
    // Apps page and Manager page have a review in progress to show.
    // Matches what was logged through its date, except asphalt: 300 TON
    // billed against 244 logged -- what the engineer's comment questions.
    id: crypto.randomUUID(), estimateNo: '2', date: dates[16], note: 'Pay Application 2',
    itemTotals: { '201-01': 15000, '202-01': 1230, '502-01': 300, '701-03': 746, '702-01': 4, '713-01': 19500 },
    approvalStatus: 'changes_requested', updatedAt: Date.now(),
    comments: [{ id: crypto.randomUUID(), author: 'Jordan Lee, P.E.', text: 'Asphalt (502-01) is higher than the tickets I have. Can you double check it?', createdAt: Date.now() - 7200000 }],
  }];
  await saveProject(fresh);
  return project.id;
}
