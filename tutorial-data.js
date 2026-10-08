// Example data for tutorial mode (see tutorial.html). Only ever loaded by
// tutorial.html, after it has switched this tab into tutorial mode, so
// every save below lands in the separate tutorial database -- never the
// real one. Dates are relative to today so the example always looks
// current: about four weeks of weekday reports ending yesterday, which
// leaves today open for the report the person writes in the tour.

// The example people, all named with civil puns. TUTORIAL_USER is "you"
// (the reports' author and Representative); a second inspector from
// TUTORIAL_INSPECTORS helps on each working day, taking turns.
const TUTORIAL_USER = 'Phil Dirt';
const TUTORIAL_INSPECTORS = ['Barry Cade', 'Cole Patch', 'Manny Hole', 'Dusty Rhodes', 'Mac Adam'];
const TUTORIAL_ENGINEER = 'Ken Crete, P.E.';
const TUTORIAL_COMPANY = { code: 'TUTORIAL', name: 'Example Construction Co.' };

// Each report's day: what was worked on, which pay items were logged, and
// any special handling (weather day, no work day, approval/comments).
const TUTORIAL_DAYS = [
  { activity: 'Mobilization, clearing', summary: 'Contractor mobilized and set up the staging area at Witcham St & Jackson St. Clearing and grubbing along the north shoulder, Sta. 10+00 to 14+50. A paper boat was found in the inlet; left in place.', pay: [['201-01', 4500]], weather: 'Sunny', hi: 84, lo: 66, photos: ['Staging area set up', 'Clearing north shoulder'], short: "Mobilization, clearing (paper boat left in the inlet)", conditions: "Dry. Storm drain smells faintly of popcorn." },
  { activity: 'Clearing, traffic control setup', summary: 'Finished clearing to Sta. 18+00. Traffic control installed advance warning signs and the lane closure taper per the TCP. Someone tied a red balloon to the first sign. Removed it. It came back.', pay: [['201-01', 6000], ['713-01', 9500]], weather: 'Sunny', hi: 86, lo: 68, photos: ['Lane closure taper installed'], controlling: "Traffic control setup", conditions: "Clear. Balloons: 1, red, recurring." },
  { activity: 'Pavement removal', summary: 'Saw-cut and removed existing asphalt pavement, Sta. 10+00 to 12+75. Hauled millings off site.', pay: [['202-01', 310, 'Saw cut first. Millings hauled off. The balloon was not hauled off; it floated away on its own.']], weather: 'Partly cloudy', hi: 85, lo: 69, photos: ['Saw-cutting existing pavement', 'Pavement removal'] },
  { activity: 'Pavement removal', summary: 'Continued pavement removal to Sta. 15+40. Located an unmarked water service at Sta. 14+10; contractor exposed it by hand and notified the utility.', pay: [['202-01', 340], ['201-01', 4500]], weather: 'Partly cloudy', hi: 83, lo: 67, photos: ['Unmarked water service exposed'] },
  { activity: '', notes: 'WEATHER DAY', summary: 'Thunderstorms all day; site too wet to work. Water in the storm drain was rising. So was the singing.', weather: 'Thunderstorms', hi: 78, lo: 70 },
  { activity: 'Drain pipe installation', summary: 'Began trenching for the 24" storm drain at Sta. 10+00. Installed 96 LF of pipe and bedding; trench box in use. Pipe crew reports a voice in the line saying "we all float down here." Confined space permit updated.', pay: [['701-03', 96, 'Bedding per detail. Do not look into the open end of the pipe.']], weather: 'Overcast', hi: 80, lo: 68, photos: ['Trench box in place', 'Pipe bedding', '24-inch pipe laid'], approval: 'approved', tests: [["Joint Inspection", "Joints tight. Something knocked back from inside the pipe."]] },
  { activity: 'Drain pipe installation', summary: 'Installed 128 LF of 24" pipe, Sta. 10+96 to 12+24. Backfilled and compacted in 8" lifts; density tests passed.', pay: [['701-03', 128]], weather: 'Sunny', hi: 87, lo: 70, photos: ['Backfill and compaction'], approval: 'approved', tests: [["Nuclear Density (Soil)", "98%, 99%, 97%. Passed. Gauge screen briefly read \"YOU'LL FLOAT TOO\"; sent out for calibration."]] },
  { activity: 'Drain pipe, catch basin', summary: 'Installed 110 LF of pipe and set Catch Basin CB-1 at Sta. 12+30.', pay: [['701-03', 110], ['702-01', 1]], weather: 'Sunny', hi: 88, lo: 71, photos: ['Catch basin CB-1 set', 'Pipe connection at CB-1'], approval: 'approved', traffic: 'ATTENTION_REQUIRED', trafficNote: 'Two drums knocked down overnight near Sta. 11+00; replaced by 7:30 AM.' },
  { activity: 'Drain pipe installation', summary: 'Installed 140 LF of pipe to Sta. 13+80. Inspector verified grade with a laser at 50 ft intervals. Crew asked to be out of the pipe before dark. Request granted.', pay: [['701-03', 140]], weather: 'Partly cloudy', hi: 86, lo: 70, photos: ['Checking pipe grade'], approval: 'approved', tests: [["Mandrel (Deflection) Test", "Passed. The mandrel came back out with a balloon string tied to it."]] },
  { activity: '', notes: 'NO WORK DAY', summary: 'Contractor waiting on catch basin delivery.', weather: 'Sunny', hi: 85, lo: 69 },
  { activity: 'Catch basins', summary: 'Set Catch Basins CB-2 and CB-3 at Sta. 14+20 and 15+60. Grouted pipe connections. CB-3 arrived with a red balloon tied to the grate; supplier denies shipping it.', pay: [['702-01', 2]], weather: 'Overcast', hi: 82, lo: 70, photos: ['Catch basin CB-2', 'Grouting pipe connection'], approval: 'changes_requested', comment: { author: TUTORIAL_ENGINEER, text: 'Please add the catch basin rim elevations to this report before I approve it.' }, reply: "Rim elevations added. Also, the balloon on CB-3 is back." },
  { activity: 'Drain pipe installation', summary: 'Installed 152 LF of pipe, Sta. 15+60 to 17+12.', pay: [['701-03', 152]], weather: 'Sunny', hi: 89, lo: 72, photos: ['Pipe installation, Sta. 16+00'], approval: 'approved', conditions: "Hot. The storm drain echoes laughter at lunch." },
  { activity: 'Drain pipe, catch basin', summary: 'Installed 120 LF of pipe and set Catch Basin CB-4 at Sta. 18+30. Storm drain mainline complete to Sta. 18+30. Final camera run found the line clean except for one oversized clown shoe at Sta. 16+40.', pay: [['701-03', 120], ['702-01', 1], ['713-01', 6000]], weather: 'Sunny', hi: 90, lo: 73, photos: ['Catch basin CB-4', 'Mainline complete'], approval: 'approved', tests: [["CCTV Video Inspection", "Line clean. One oversized clown shoe at Sta. 16+40, size 27."]] },
  { activity: 'Base course', summary: 'Placed and compacted crushed stone base, Sta. 10+00 to 13+50.', pay: [['202-01', 280]], weather: 'Partly cloudy', hi: 87, lo: 71, photos: ['Placing stone base'], pinComment: { author: TUTORIAL_ENGINEER, text: 'Is this the area where the water service was found? Please confirm it was reconnected.', page: 0, x: 0.62, y: 0.38 }, reply: "Yes, same spot. Reconnected and pressure tested. The voice in the pipe also says hi." },
  { activity: 'Base course', summary: 'Placed and compacted stone base, Sta. 13+50 to 18+00. Proof-rolled; one soft spot at Sta. 16+20 undercut and replaced.', pay: [['202-01', 300]], weather: 'Sunny', hi: 88, lo: 72, photos: ['Proof-rolling base', 'Soft spot undercut'], tests: [["Proof Roll", "Soft spot at Sta. 16+20 undercut and replaced. Found the other clown shoe in the undercut."]] },
  { activity: 'Asphalt paving', summary: 'Placed first lift of asphalt, Sta. 10+00 to 14+00. Mat temperature and density checked every 200 ft.', pay: [['502-01', 118]], weather: 'Sunny', hi: 89, lo: 73, photos: ['Paving first lift', 'Checking mat temperature'], tests: [["Mat Temperature", "295 F, steady. The red balloon kept well clear of the paver, which seems fair."]] },
  { activity: 'Asphalt paving', summary: 'Placed first lift of asphalt, Sta. 14+00 to 18+30.', pay: [['502-01', 126, 'Load tickets on file for every truck. Counted twice. Nothing in the pipe helped count.'], ['713-01', 4000]], weather: 'Partly cloudy', hi: 87, lo: 72, photos: ['Paving, Sta. 16+00'] },
  { activity: 'Asphalt paving', summary: 'Placed surface course, Sta. 10+00 to 12+50. Rolling pattern established; joints tack-coated.', pay: [['502-01', 92]], weather: 'Sunny', hi: 88, lo: 71, photos: ['Surface course', 'Rolling the mat'], controlling: "Asphalt surface course", conditions: "Overcast. Balloon count today: 0. Suspicious." },
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

// The last `count` weekdays before today, oldest first. Never today: a
// new report the person starts would warn that the date is already taken.
function tutorialWeekdays(count) {
  const out = [];
  for (let back = 1; out.length < count; back++) {
    const d = new Date();
    d.setDate(d.getDate() - back);
    if (d.getDay() !== 0 && d.getDay() !== 6) out.unshift(tutorialIsoDaysAgo(back));
  }
  return out;
}

// DEMO-101, the project the guided tour walks through. Its numbers are the
// ones the tour's lines (and the quantities suite) talk about, so change
// them with care.
const TUTORIAL_DEMO = {
  projectNo: 'DEMO-101',
  name: 'DEMO-101 - Derry Storm Drain',
  projectName: 'Witcham Street Storm Drain Improvements, Derry, Maine',
  icon: '\u{1F6A7}',
  contractLength: '120',
  engineer: TUTORIAL_ENGINEER,
  helpers: TUTORIAL_INSPECTORS,
  contractors: ['Losers Club Constructors', 'Kenduskeag Paving', 'Neibolt Street Traffic Control'],
  catalog: [
    { itemNumber: '201-01', description: 'Clearing and Grubbing', unit: 'LS', plannedQty: 1, unitPrice: 15000 },
    { itemNumber: '202-01', description: 'Removal of Existing Pavement', unit: 'SY', plannedQty: 2400, unitPrice: 12.5 },
    { itemNumber: '502-01', description: 'Asphalt Concrete', unit: 'TON', plannedQty: 650, unitPrice: 145 },
    { itemNumber: '701-03', description: '24" Storm Drain Pipe', unit: 'LF', plannedQty: 1800, unitPrice: 95 },
    { itemNumber: '702-01', description: 'Catch Basin', unit: 'EA', plannedQty: 14, unitPrice: 4200 },
    { itemNumber: '713-01', description: 'Temporary Traffic Control', unit: 'LS', plannedQty: 1, unitPrice: 38000 },
  ],
  // Crew counts in the Contractors Force & Equipment table: one column per
  // contractor, one row per role/equipment label. The paver crew shows up
  // on asphalt days.
  crew: (day) => {
    const paving = day.pay.some(([n]) => n === '502-01');
    return { Superintendent: ['1'], Foreman: ['1', paving ? '1' : ''], Operators: ['3', paving ? '4' : ''], Laborers: ['5', ''], 'Pickup truck': ['2', '', '1'], 'Attenuator truck': ['', '', '1'] };
  },
  days: TUTORIAL_DAYS,
  payApps: (dates) => [{
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
    comments: [{ id: crypto.randomUUID(), author: TUTORIAL_ENGINEER, text: 'Asphalt (502-01) is higher than the tickets I have. Can you double check it?', createdAt: Date.now() - 7200000 }],
  }],
};

// The other example projects: one of each kind of job, all very obviously
// made up. Same shape as TUTORIAL_DEMO; a day's `pay` logs [item, qty]
// (a Lump Sum item logs dollars, as in the app). `ntpDaysAgo` sets how
// far into the contract each one is, so the Manager Dashboard has a mix
// of on-pace and behind-schedule jobs, and `everyNth` spreads the reports
// out (one every Nth weekday, the last one yesterday) across that time.
const TUTORIAL_OTHER_PROJECTS = [
  {
    projectNo: 'SHIRE-007',
    name: 'SHIRE-007 - Green Dragon Inn East Wing',
    projectName: 'Green Dragon Inn Addition, Bywater, The Shire',
    icon: '\u{1F3E1}',
    contractLength: '180',
    ntpDaysAgo: 40,
    everyNth: 4,
    engineer: 'Archie Tect, P.E.',
    helpers: ['Sandy Loam', 'Mason Jarr'],
    contractors: ['Proudfoot Masonry', 'Gamgee & Sons Landscaping', 'Brandybuck Ferry & Hauling'],
    catalog: [
      { itemNumber: '100-01', description: 'Round Door, Green, Brass Knob Dead Center', unit: 'EA', plannedQty: 4, unitPrice: 2500 },
      { itemNumber: '210-01', description: 'Hillside Excavation (Smial)', unit: 'CY', plannedQty: 850, unitPrice: 38 },
      { itemNumber: '320-01', description: 'Oak Timber Framing', unit: 'MBF', plannedQty: 42, unitPrice: 1900 },
      { itemNumber: '410-01', description: 'Fieldstone Chimney', unit: 'EA', plannedQty: 3, unitPrice: 6800 },
      { itemNumber: '520-01', description: 'Living Turf Roof', unit: 'SF', plannedQty: 6000, unitPrice: 14 },
      { itemNumber: '610-01', description: 'Ale Cellar, Climate Controlled', unit: 'LS', plannedQty: 1, unitPrice: 45000 },
      { itemNumber: '900-01', description: 'Second Breakfast Allowance', unit: 'LS', plannedQty: 1, unitPrice: 8000 },
    ],
    crew: () => ({ Superintendent: ['1'], Foreman: ['1', '1'], Laborers: ['4', '3'], 'Pickup truck': ['', '', '1'] }),
    days: [
      { activity: 'Layout', summary: 'Staked out the east wing. Mr. Proudfoot disputed the stakes along his hedge; the survey puts them 4 in. inside the Inn\'s property. He remains unconvinced.', pay: [], weather: 'Pleasant, light breeze', hi: 72, lo: 55, photos: ['East wing staked out'], short: "Layout. Hedge dispute ongoing.", comments: [{ author: "Archie Tect, P.E.", text: "Please do not move the stakes to make Mr. Proudfoot happy. He will not be happy.", reply: "Understood. He has now disputed the hedge itself." }] },
      { activity: 'Hillside excavation', summary: 'Dug 180 CY into the hill for the east wing. Work paused at 9:00 for second breakfast and 11:00 for elevenses, per local custom (see Second Breakfast Allowance).', pay: [['210-01', 180], ['900-01', 600, 'Second breakfast for 23 hobbits. Elevenses to be billed next week.']], weather: 'Sunny', hi: 74, lo: 56, photos: ['Excavating into the hill'], tests: [["Proctor (Moisture-Density)", "Max dry density 112 pcf. Lab tech asked if that was before or after supper."]] },
      { activity: 'Hillside excavation', summary: 'Excavated another 240 CY. A laborer found a plain gold ring in the spoil pile and would not hand it over, calling it "precious." The laborer is no longer with the project.', pay: [['210-01', 240], ['900-01', 600]], weather: 'Partly cloudy', hi: 71, lo: 54, photos: ['Spoil pile (ring not pictured)'], conditions: "Pleasant. One laborer missing, last seen muttering.", comments: [{ author: "Archie Tect, P.E.", text: "Is the ring still on site? If so, do NOT put it in the concrete.", reply: "Not on site. A wizard came by, took a very strong interest in it, and left in a hurry." }] },
      { activity: '', notes: 'NO WORK DAY', summary: 'Birthday party at the Party Tree. Entire crew, the contractor and the inspector attended. The host vanished mid-speech.', weather: 'Sunny', hi: 75, lo: 57 },
      { activity: 'Timber framing', summary: 'Set oak beams for the new common room. Ceiling height 6\'-2" per the Shire building code. A "Mind your head" sign for tall wizards is on order.', pay: [['320-01', 12], ['900-01', 600]], weather: 'Pleasant', hi: 73, lo: 55, photos: ['Oak beams set'], approval: 'approved', tests: [["Other (describe)", "Head-knock test: passed for hobbits. Failed for the wizard. Twice."]] },
      { activity: 'Round doors', summary: 'Hung two round green doors. Brass knobs verified dead center per spec Section 08 11 00. A visiting wizard scratched a rune into one; contractor to repaint at no cost.', pay: [['100-01', 2, 'Knobs dead center, verified with a tape and a very serious hobbit.']], weather: 'Light rain', hi: 66, lo: 54, photos: ['Round door, east entrance', 'Rune to be painted over'], approval: 'approved', controlling: "Round doors, Section 08 11 00" },
      { activity: 'Turf roof', summary: 'Laid 1,800 SF of living turf roof on the east wing. Rabbit damage noted at the NE corner.', pay: [['520-01', 1800], ['900-01', 600]], weather: 'Sunny', hi: 76, lo: 58, photos: ['Turf roof going on'], approval: 'changes_requested', comment: { author: 'Archie Tect, P.E.', text: 'Please confirm the rabbits were relocated, and not, as one of the gardeners suggested, stewed.' }, reply: "Rabbits relocated to the Gamgee garden. Nobody stewed anything. One was briefly discussed." },
    ],
  },
  {
    projectNo: 'TAT-0042',
    name: 'TAT-0042 - Moisture Farm Geotech',
    projectName: 'Lars Moisture Farm Foundation Investigation, Tatooine',
    icon: '\u{1F3DC}\u{FE0F}',
    contractLength: '60',
    ntpDaysAgo: 20,
    everyNth: 2,
    engineer: 'Dee Watering, P.E.',
    helpers: ['Augie Drill', 'Cory Sample'],
    contractors: ['Jawa Drilling Co.', 'Anchorhead Lab Services', 'Tosche Station Supply'],
    catalog: [
      { itemNumber: '101-01', description: 'Mobilization (Bantha-Drawn)', unit: 'LS', plannedQty: 1, unitPrice: 12000 },
      { itemNumber: '201-01', description: 'Soil Boring, Sand', unit: 'LF', plannedQty: 400, unitPrice: 65 },
      { itemNumber: '201-02', description: 'Standard Penetration Test', unit: 'EA', plannedQty: 80, unitPrice: 45 },
      { itemNumber: '202-01', description: 'Cone Penetration Test Sounding', unit: 'LF', plannedQty: 300, unitPrice: 30 },
      { itemNumber: '301-01', description: 'Lab Test, Grain Size (It Is Sand)', unit: 'EA', plannedQty: 40, unitPrice: 120 },
      { itemNumber: '301-02', description: 'Lab Test, Moisture Content', unit: 'EA', plannedQty: 40, unitPrice: 60 },
      { itemNumber: '401-01', description: 'Sand Removal From Equipment', unit: 'HR', plannedQty: 200, unitPrice: 95 },
    ],
    crew: () => ({ Foreman: ['1'], Operators: ['2'], Laborers: ['2', '1'], 'Pickup truck': ['1', '1'] }),
    days: [
      { activity: 'Mobilization', summary: 'Drill rig arrived from Anchorhead. The Jawa crew described it as "mostly working." It sparked during the first inspection, so it got a second one.', pay: [['101-01', 12000, 'Bantha fed and watered. The bantha is not a pay item.']], weather: 'Clear, two suns', hi: 128, lo: 71, photos: ['Drill rig (mostly working)'], short: "Rig mobilized (mostly working)", conditions: "Two suns. Coffee was hot before it was poured." },
      { activity: 'Borings B-1, B-2', summary: 'Drilled B-1 and B-2 to 50 ft. Soil: SAND, fine; SAND, coarse; and SAND. Groundwater not encountered, to nobody\'s surprise.', pay: [['201-01', 100], ['201-02', 20]], weather: 'Clear, two suns', hi: 131, lo: 73, photos: ['Boring B-1', 'Split spoon sample (sand)'], tests: [["Sieve Analysis (Gradation)", "100% sand. Ran it again: 100% sand."], ["Moisture Content", "0.0%. We checked twice. Then a third time, out of pity."]] },
      { activity: 'Boring B-3', summary: 'B-3 terminated at 12 ft when the driller reported the hole "growled." Boring offset 200 ft east per the Sarlacc avoidance plan.', pay: [['201-01', 12], ['201-02', 2]], weather: 'Clear, two suns', hi: 129, lo: 72, photos: ['B-3, abandoned'], approval: 'approved', comments: [{ author: "Dee Watering, P.E.", text: "Please log the Sarlacc on the boring log as unsuitable material.", reply: "Done. Logged as \"SAND, with teeth.\"" }] },
      { activity: '', notes: 'WEATHER DAY', summary: 'Sandstorm, visibility zero.', weather: 'Sandstorm', hi: 118, lo: 80 },
      { activity: 'CPT soundings', summary: 'Pushed CPT-1 and CPT-2 to refusal at 40 ft. Sand People observed on the ridge all afternoon; no contact. Crew kept the rig horn handy.', pay: [['202-01', 80]], weather: 'Clear, two suns', hi: 127, lo: 70, photos: ['CPT rig set up'], traffic: "ATTENTION_REQUIRED", trafficNote: "Sand People crossed the haul road at 2:00 PM. Flagger held traffic. Nobody argued." },
      { activity: 'Lab testing', summary: 'Delivered 18 samples to the lab in Mos Eisley. Moisture contents: 0.0%, 0.0%, and 0.1% (that sample was sneezed on).', pay: [['301-01', 18], ['301-02', 18]], weather: 'Clear, two suns', hi: 130, lo: 72, photos: ['Samples to the lab'], approval: 'changes_requested', comment: { author: 'Dee Watering, P.E.', text: 'Moisture farm, 0.0% moisture. Please confirm the owner knows.' }, reply: "Owner says the moisture is in the air, that is the whole point of a moisture farm. Owner may have a point." },
      { activity: 'Equipment cleaning', summary: 'Cleaned sand out of the rig, the truck, the inspector\'s boots, and somehow the sealed sample jars. It\'s coarse and rough and irritating, and it gets everywhere.', pay: [['401-01', 24]], weather: 'Clear, two suns', hi: 128, lo: 71, photos: ['Sand, everywhere'], conditions: "Sand. Everywhere.", tests: [["Other (describe)", "Boot test: emptied 1.2 lb of sand from the inspector's boots. Boots were laced the whole time."]] },
    ],
  },
  {
    projectNo: 'MOR-0001',
    name: 'MOR-0001 - Bridge of Khazad-dum',
    projectName: 'Bridge of Khazad-dum Replacement, Moria',
    icon: '\u{1F309}',
    contractLength: '365',
    ntpDaysAgo: 330,
    everyNth: 30,
    engineer: 'Gail Vanized, P.E.',
    helpers: ['Abby Utment', 'Pierce Cap'],
    contractors: ["Durin's Folk Ironworks", 'Khazad Concrete Co.', 'Watcher Pumping Services'],
    catalog: [
      { itemNumber: '105-01', description: 'Removal of Previous Bridge (Balrog Incident)', unit: 'LS', plannedQty: 1, unitPrice: 85000 },
      { itemNumber: '401-01', description: 'Mithril Reinforcing Steel', unit: 'LB', plannedQty: 12000, unitPrice: 950 },
      { itemNumber: '402-01', description: 'Structural Steel, Dwarf-Forged', unit: 'LB', plannedQty: 180000, unitPrice: 4.5 },
      { itemNumber: '501-01', description: 'Bridge Deck Concrete', unit: 'CY', plannedQty: 320, unitPrice: 900 },
      { itemNumber: '601-01', description: 'Handrails (First Ever on This Crossing)', unit: 'LF', plannedQty: 300, unitPrice: 210 },
      { itemNumber: '701-01', description: 'Fire-Resistant Coating', unit: 'SF', plannedQty: 9000, unitPrice: 18 },
    ],
    crew: () => ({ Superintendent: ['1'], Foreman: ['1', '1'], Operators: ['2', '1'], Laborers: ['6', '4', '1'] }),
    days: [
      { activity: 'Debris removal', summary: 'Removed what was left of the old bridge: 2 ft wide, no handrails, over a bottomless chasm. We have questions about the original design. No sign of the previous occupant; inspector recommends keeping it that way.', pay: [['105-01', 34000, '40% complete. No Balrog parts found. Please do not ask what Balrog parts would look like.']], weather: 'Dark (underground)', hi: 68, lo: 68, photos: ['What was left of the old bridge'], conditions: "Dark. Torches required. The echo works fine." },
      { activity: 'East abutment', summary: 'Formed and poured the east abutment, 45 CY. Crew reported drums in the deep again. Foreman confirmed it was the concrete vibrator.', pay: [['501-01', 45]], weather: 'Dark (underground)', hi: 68, lo: 68, photos: ['East abutment pour'], tests: [["Slump", "4 in."], ["Cylinders Cast", "Set of 4. The crew labeled one \"Durin's Day.\""], ["Concrete Temperature", "68 F. Everything down here is 68 F."]] },
      { activity: 'Structural steel', summary: 'Erected girders G1 to G4. The ironworkers sing the whole time; the Watcher in the Water filed a noise complaint.', pay: [['402-01', 64000]], weather: 'Dark, echoing', hi: 69, lo: 68, photos: ['Girders G1 to G4'], tests: [["Bolt Torque", "All bolts to spec. The ironworkers sang the torque values."]] },
      { activity: 'Mithril reinforcing', summary: 'Placed mithril reinforcing in the deck: light as a feather, hard as dragon scales. Bar count verified twice. Nobody is taking any home.', pay: [['401-01', 3200]], weather: 'Dark (underground)', hi: 68, lo: 68, photos: ['Mithril rebar in the deck'], approval: 'approved', tests: [["Rebar Inspection", "Bar count 312. A dwarf recounted: 311. Recounted after a pat-down: 312."]] },
      { activity: '', notes: 'NO WORK DAY', summary: 'Crew refused to cross after a voice boomed "You shall not pass." It was the flagger. Flagger has been retrained.', weather: 'Dark (underground)', hi: 68, lo: 68 },
      { activity: 'Handrails', summary: 'Installed 120 LF of handrail on the north side, the first handrails this crossing has ever had. Wizards in particular should appreciate them.', pay: [['601-01', 120]], weather: 'Dark (underground)', hi: 68, lo: 68, photos: ['North handrail'], approval: 'changes_requested', comment: { author: 'Gail Vanized, P.E.', text: 'Handrail height has to work for dwarves AND wizards. Please verify 42 in. on the north side.' }, reply: "42 in. verified. A wizard tested it in person and said it would have changed everything." },
      { activity: 'Fire-resistant coating', summary: 'Applied intumescent coating to girders G1 to G4. Rated for 2 hours or 1 Balrog, whichever comes first.', pay: [['701-01', 3600]], weather: 'Dark, slightly warm', hi: 71, lo: 68, photos: ['Coating the girders'], controlling: "Fire protection of girders", tests: [["Coating Thickness", "40 mils. The applicator asked what happens after 2 hours. Nobody answered."]] },
    ],
    payApps: (dates) => [{
      id: crypto.randomUUID(), estimateNo: '1', date: dates[3], note: 'Pay Application 1',
      itemTotals: { '105-01': 34000, '501-01': 45, '402-01': 64000, '401-01': 3200 },
      approvalStatus: 'approved', updatedAt: Date.now(),
    }],
  },
  {
    projectNo: 'OZ-1900',
    name: 'OZ-1900 - Yellow Brick Road Rehab',
    projectName: 'Yellow Brick Road Rehabilitation, Munchkinland to Emerald City',
    icon: '\u{1F9F1}',
    contractLength: '150',
    ntpDaysAgo: 60,
    everyNth: 6,
    engineer: 'Rhoda Grader, P.E.',
    helpers: ['Patty Pavement', 'Mill N. Overlay'],
    contractors: ['Munchkin Paving Co.', 'Tin Man Welding & Fab', 'Emerald City Traffic Control'],
    catalog: [
      { itemNumber: '201-01', description: 'Removal of Damaged Yellow Brick', unit: 'SY', plannedQty: 3000, unitPrice: 18 },
      { itemNumber: '301-01', description: 'Crushed Stone Base', unit: 'TON', plannedQty: 1800, unitPrice: 42 },
      { itemNumber: '401-01', description: 'Yellow Brick Pavers, Munchkin Gold', unit: 'SY', plannedQty: 3000, unitPrice: 135 },
      { itemNumber: '402-01', description: 'Spiral Section Realignment', unit: 'LS', plannedQty: 1, unitPrice: 60000 },
      { itemNumber: '501-01', description: 'Poppy Field Mowing', unit: 'ACRE', plannedQty: 40, unitPrice: 650 },
      { itemNumber: '601-01', description: 'Flying Monkey Netting', unit: 'LF', plannedQty: 2000, unitPrice: 28 },
      { itemNumber: '701-01', description: 'Traffic Control (Lions, Tigers and Bears)', unit: 'LS', plannedQty: 1, unitPrice: 22000 },
    ],
    crew: () => ({ Superintendent: ['1'], Foreman: ['1', '1'], Operators: ['2'], Laborers: ['6', '1'], 'Pickup truck': ['1', '1', '1'], 'Attenuator truck': ['', '', '1'] }),
    days: [
      { activity: 'Brick removal', summary: 'Removed cracked yellow brick, Sta. 0+00 to 3+10, starting from the center of the spiral in Munchkinland. Munchkins lined the road and sang the whole time.', pay: [['201-01', 420], ['701-01', 4000]], weather: 'Sunny, rainbow', hi: 79, lo: 60, photos: ['Brick removal at the spiral'], short: "Brick removal, from the spiral outward", conditions: "Sunny, rainbow, constant singing." },
      { activity: 'Brick removal, base', summary: 'Removed brick to Sta. 6+00 and placed crushed stone base. The crew kept following the yellow brick road; inspector reminded them it is the thing being replaced.', pay: [['201-01', 380], ['301-01', 210]], weather: 'Sunny', hi: 81, lo: 61, photos: ['Stone base going down'], tests: [["Nuclear Density (Soil)", "97%. The Scarecrow checked the math. He is surprisingly good at it now."]] },
      { activity: 'Poppy mowing', summary: 'Mowed 12 acres of poppies along the shoulder. Two laborers fell asleep in the field and were revived with snow. Respirators are now required.', pay: [['501-01', 12]], weather: 'Partly cloudy', hi: 78, lo: 60, photos: ['Poppy field, mowed'], conditions: "Sleepy. Very sleepy.", traffic: "ATTENTION_REQUIRED", trafficNote: "Lion asleep across both lanes for 40 min. Detoured through the poppies. Bad idea." },
      { activity: 'Brick paving', summary: 'Laid 520 SY of new yellow brick. Color checked against the approved Munchkin Gold sample; one pallet rejected for being "more of a mustard."', pay: [['401-01', 520]], weather: 'Sunny', hi: 82, lo: 62, photos: ['New yellow brick', 'Rejected pallet (mustard)'], approval: 'approved', tests: [["Straightedge / Smoothness", "Within 1/8 in. A girl in sparkly shoes walked the whole length clicking her heels. No defects found."]] },
      { activity: '', notes: 'WEATHER DAY', summary: 'Tornado. A farmhouse from Kansas landed at Sta. 2+00. Contractor to haul it off as extra work.', weather: 'Tornado', hi: 74, lo: 58 },
      { activity: 'Monkey netting', summary: 'Installed 600 LF of flying monkey netting through the Haunted Forest. Three monkeys tested it at once. Netting held.', pay: [['601-01', 600]], weather: 'Overcast, ominous', hi: 70, lo: 57, photos: ['Netting, Haunted Forest'], comments: [{ author: "Rhoda Grader, P.E.", text: "How exactly did the monkeys \"test\" the netting? Was this approved?", reply: "They volunteered. Strongly." }] },
      { activity: 'Brick paving', summary: 'Laid 610 SY of yellow brick to Sta. 9+40. The Tin Man welded the drainage grates and asked for an oil can on the next change order.', pay: [['401-01', 610], ['701-01', 3000]], weather: 'Sunny', hi: 80, lo: 61, photos: ['Paving toward the Emerald City'], approval: 'changes_requested', comment: { author: 'Rhoda Grader, P.E.', text: 'Please send the brick color test results. The Wizard is very particular. (Has anyone actually met the Wizard?)' }, reply: "Color test results attached. Also, we met the Wizard. He is a man behind a curtain. Please do not tell anyone." },
    ],
    payApps: (dates) => [{
      id: crypto.randomUUID(), estimateNo: '1', date: dates[3], note: 'Pay Application 1',
      itemTotals: { '201-01': 800, '301-01': 210, '501-01': 12, '401-01': 520, '701-01': 4000 },
      approvalStatus: 'approved', updatedAt: Date.now(),
    }],
  },
  {
    projectNo: 'PAW-0048',
    name: 'PAW-0048 - Lot 48 Children\'s Park',
    projectName: 'Lot 48 Children\'s Park (Formerly "The Pit"), Pawnee, Indiana',
    icon: '\u{1F333}',
    contractLength: '120',
    ntpDaysAgo: 50,
    everyNth: 5,
    engineer: 'Penny Trometer, P.E.',
    helpers: ['Sandy Box', 'Woody Chips'],
    contractors: ['Very Good Building & Development Co.', 'Mouse Rat Hauling', 'Sweetums Landscaping'],
    catalog: [
      { itemNumber: '100-01', description: 'Fill the Pit', unit: 'CY', plannedQty: 4800, unitPrice: 22 },
      { itemNumber: '200-01', description: 'Remove Couch From Pit', unit: 'EA', plannedQty: 1, unitPrice: 350 },
      { itemNumber: '300-01', description: 'Playground Structure, Installed', unit: 'EA', plannedQty: 6, unitPrice: 18000 },
      { itemNumber: '310-01', description: 'Engineered Wood Fiber Surfacing', unit: 'CY', plannedQty: 220, unitPrice: 65 },
      { itemNumber: '400-01', description: 'Waffle Stand', unit: 'LS', plannedQty: 1, unitPrice: 15000 },
      { itemNumber: '500-01', description: 'Li\'l Sebastian Memorial (Life Size, So Small)', unit: 'EA', plannedQty: 1, unitPrice: 9500 },
      { itemNumber: '600-01', description: 'Safety Fence Around Pit', unit: 'LF', plannedQty: 900, unitPrice: 14 },
    ],
    crew: () => ({ Superintendent: ['1'], Foreman: ['1', '', '1'], Operators: ['2', '1'], Laborers: ['4', '', '3'], 'Pickup truck': ['1', '1', '1'] }),
    days: [
      { activity: 'Pit fencing', summary: 'Installed 900 LF of safety fence around the pit. A local musician who used to live in the pit confirmed nobody is down there now.', pay: [['600-01', 900]], weather: 'Partly cloudy', hi: 64, lo: 45, photos: ['Fence around the pit'], short: "Fence up. Pit secured. Pit still a pit.", conditions: "Partly cloudy. Pit smells like a pit." },
      { activity: 'Pit fill', summary: 'Placed and compacted 1,200 CY of fill in 12 in. lifts. The Deputy Parks Director stopped by with a color-coded binder of 41 park designs and stayed until dark.', pay: [['100-01', 1200]], weather: 'Sunny', hi: 66, lo: 44, photos: ['Filling the pit', 'The binder'], tests: [["Proctor (Moisture-Density)", "Max dry density 118 pcf. The Deputy Parks Director laminated the results."]], comments: [{ author: "Penny Trometer, P.E.", text: "Please stop letting the Deputy Parks Director sign the density reports.", reply: "She says she is helping. To be fair, she is very helpful." }] },
      { activity: 'Couch removal, fill', summary: 'Pulled an old couch, a guitar, and a Mouse Rat setlist out of the pit before backfilling. Placed 900 CY of fill.', pay: [['200-01', 1, 'One couch, plaid. Guitar returned to its owner. Setlist kept for the project file.'], ['100-01', 900]], weather: 'Overcast', hi: 61, lo: 46, photos: ['Couch, retrieved'] },
      { activity: '', notes: 'NO WORK DAY', summary: 'Public forum ran 9 hours. One resident demanded the park be named after his dog; another wanted it to be a mini golf course.', weather: 'Rain', hi: 55, lo: 43 },
      { activity: 'Pit fill complete', summary: 'Placed the last 1,500 CY. The pit is officially no longer a pit. The Parks Director said he liked it better as a pit, then left to go build a canoe.', pay: [['100-01', 1500]], weather: 'Sunny', hi: 63, lo: 42, photos: ['No longer a pit'], approval: 'approved', tests: [["Nuclear Density (Soil)", "98%. The Parks Director said compaction is the only government work he respects."]] },
      { activity: 'Playground', summary: 'Set two play structures and placed 80 CY of wood fiber surfacing. Fall height checked to ASTM F1292. Kids already lined up at the fence.', pay: [['300-01', 2], ['310-01', 80]], weather: 'Sunny', hi: 65, lo: 44, photos: ['Play structures set', 'Wood fiber surfacing'], approval: 'approved', tests: [["Other (describe)", "Slide test, performed by the inspector. Result: wheee."]] },
      { activity: 'Memorial, waffle stand', summary: 'Set the Li\'l Sebastian memorial. Started the waffle stand rough-in. Several staff members were seen crying at the memorial; work continued.', pay: [['500-01', 1], ['400-01', 5000]], weather: 'Clear', hi: 60, lo: 41, photos: ['Li\'l Sebastian memorial'], approval: 'changes_requested', comment: { author: 'Penny Trometer, P.E.', text: 'The plaque says "Li\'l Sebastion." Please fix it before the candlelight vigil.' }, reply: "Plaque fixed. 5,000 candles ordered for the vigil." },
    ],
  },
  {
    projectNo: 'NYC-1984',
    name: 'NYC-1984 - Midtown Sewer Rehab',
    projectName: 'Sewer Main Rehabilitation (Under Midtown), New York City',
    icon: '\u{1F355}',
    contractLength: '90',
    ntpDaysAgo: 35,
    everyNth: 3,
    engineer: 'Manny Fold, P.E.',
    helpers: ['Clay Pipe', 'Sue Werline'],
    contractors: ['Half Shell Lining Co.', 'Casey Jones Bypass Pumping', 'Channel 6 Traffic Control'],
    catalog: [
      { itemNumber: '100-01', description: 'Bypass Pumping', unit: 'LS', plannedQty: 1, unitPrice: 40000 },
      { itemNumber: '200-01', description: 'CCTV Sewer Inspection', unit: 'LF', plannedQty: 6000, unitPrice: 4 },
      { itemNumber: '300-01', description: '36" Cured-in-Place Pipe Liner', unit: 'LF', plannedQty: 2400, unitPrice: 310 },
      { itemNumber: '400-01', description: 'Manhole Rehabilitation', unit: 'EA', plannedQty: 12, unitPrice: 7500 },
      { itemNumber: '500-01', description: 'Debris Removal (Pizza Boxes)', unit: 'TON', plannedQty: 20, unitPrice: 450 },
      { itemNumber: '600-01', description: 'Tenant Relocation (4 Turtles, 1 Rat)', unit: 'EA', plannedQty: 5, unitPrice: 2000 },
      { itemNumber: '700-01', description: 'Green Ooze Containment and Disposal', unit: 'GAL', plannedQty: 500, unitPrice: 85 },
    ],
    crew: () => ({ Foreman: ['1', '1'], Operators: ['2', '1'], Laborers: ['3', '1'], 'Pickup truck': ['1', '1', '1'] }),
    days: [
      { activity: 'CCTV inspection', summary: 'Ran the camera through 1,800 LF of the 36 in. main. Found a furnished lair at MH-7: four hammocks, a skateboard ramp, and a TV wired to city power.', pay: [['200-01', 1800]], weather: 'Clear', hi: 71, lo: 58, photos: ['Camera truck at MH-5'], tests: [["CCTV Video Inspection", "1,800 LF recorded. Footage includes four teenagers waving at the camera."]] },
      { activity: 'Bypass pumping', summary: 'Set up bypass pumping from MH-5 to MH-9. A large rat in a robe asked the crew to keep it down during his meditation.', pay: [['100-01', 15000]], weather: 'Partly cloudy', hi: 69, lo: 57, photos: ['Bypass pumps running'], conditions: "Damp. The sewer smells like pizza, somehow." },
      { activity: 'Debris removal', summary: 'Removed 6 tons of pizza boxes from the main. Every box was empty. Every single one.', pay: [['500-01', 6, 'Every box empty. Toppings noted: mostly pepperoni, one pineapple (crew argued for an hour).']], weather: 'Overcast', hi: 66, lo: 55, photos: ['Pizza boxes, 6 tons'] },
      { activity: '', notes: 'NO WORK DAY', summary: 'Crew found a canister of glowing green ooze at MH-8. Hazmat called; site closed for the day.', weather: 'Clear', hi: 70, lo: 56 },
      { activity: 'Ooze disposal', summary: 'Hazmat removed 120 gal of green ooze. A laborer\'s pet turtle got splashed and has been acting strange. Very strange. Possibly karate.', pay: [['700-01', 120]], weather: 'Sunny', hi: 72, lo: 59, photos: ['Ooze drums staged for pickup'], approval: 'approved', tests: [["Other (describe)", "Ooze pH: unknown. The test strip glowed for an hour."]] },
      { activity: 'Liner installation', summary: 'Installed 420 LF of 36 in. liner. Four teenagers in masks asked if we could leave a door in it at MH-7.', pay: [['300-01', 420]], weather: 'Partly cloudy', hi: 68, lo: 57, photos: ['Liner going in at MH-6'], approval: 'changes_requested', comment: { author: 'Manny Fold, P.E.', text: 'We cannot put a door in a sewer liner. Please stop asking. Also, why are there teenagers in the sewer?' }, reply: "They say they live here. Relocation is underway (see pay item 600-01)." },
      { activity: 'Manhole rehab, relocation', summary: 'Rehabbed MH-6 and MH-7. Tenants relocated to an abandoned subway station nearby. They report better pizza delivery there.', pay: [['400-01', 2], ['600-01', 5]], weather: 'Sunny', hi: 73, lo: 60, photos: ['MH-7 rehabbed'], approval: 'approved', tests: [["Manhole Vacuum Test", "MH-6 and MH-7 passed. A turtle in a red mask held the gauge. Very steady hands."]] },
    ],
  },
  {
    projectNo: 'DEI-0001',
    name: 'DEI-0001 - Doofenshmirtz Evil Inc. Tower',
    projectName: 'Doofenshmirtz Evil Incorporated Headquarters, Danville, Tri-State Area',
    icon: '\u{1F3E2}',
    contractLength: '400',
    ntpDaysAgo: 90,
    everyNth: 8,
    engineer: 'Moe Ment, P.E.',
    helpers: ['Anna Chor', 'Weldon Joint'],
    contractors: ['Norm Bot Robotics', 'L.O.V.E.M.U.F.F.I.N. Steel Erectors', 'Tri-State Area Glazing'],
    catalog: [
      { itemNumber: '100-01', description: 'Structural Steel', unit: 'LB', plannedQty: 900000, unitPrice: 3.2 },
      { itemNumber: '200-01', description: 'Purple Tower Cladding', unit: 'SF', plannedQty: 40000, unitPrice: 55 },
      { itemNumber: '300-01', description: 'Rooftop Inator Platform', unit: 'EA', plannedQty: 1, unitPrice: 250000 },
      { itemNumber: '400-01', description: 'Self-Destruct Button (Big, Red, Unlabeled)', unit: 'EA', plannedQty: 3, unitPrice: 400 },
      { itemNumber: '500-01', description: 'Trap Door, Platypus-Rated', unit: 'EA', plannedQty: 8, unitPrice: 3200 },
      { itemNumber: '600-01', description: 'Jingle Speaker System', unit: 'LS', plannedQty: 1, unitPrice: 12000 },
      { itemNumber: '700-01', description: 'Window Replacement (Agent Entry)', unit: 'EA', plannedQty: 40, unitPrice: 1100 },
    ],
    crew: () => ({ Superintendent: ['1'], Foreman: ['', '1'], Operators: ['1', '2'], Laborers: ['', '6', '2'], 'Rough terrain crane': ['', '1'] }),
    days: [
      { activity: 'Steel erection', summary: 'Erected steel through level 12. Owner asked for the building to be "more evil." Inspector asked for that in writing.', pay: [['100-01', 120000]], weather: 'Sunny', hi: 77, lo: 60, photos: ['Steel at level 12'], conditions: "Sunny. Evil, per the owner.", tests: [["Bolt Torque", "All to spec. A robot named Norm torqued them, singing the whole time."]] },
      { activity: 'Cladding', summary: 'Hung 6,000 SF of purple cladding. Owner insists on the purple. The architect has stopped returning calls.', pay: [['200-01', 6000]], weather: 'Sunny', hi: 79, lo: 61, photos: ['Purple cladding, east face'], comments: [{ author: "Moe Ment, P.E.", text: "Is purple on the approved color schedule?", reply: "The owner says color schedules are \"for people who aren't evil.\" Logged as a submittal deviation." }] },
      { activity: 'Rooftop platform', summary: 'Set the rooftop Inator platform. Owner won\'t say what it does. Asked for design loads; he said "evil loads."', pay: [['300-01', 1, 'Platform only. The Inator (any -inator) is not part of this contract.']], weather: 'Partly cloudy', hi: 75, lo: 59, photos: ['Inator platform (purpose unknown)'], approval: 'approved' },
      { activity: 'Window replacement', summary: 'Replaced 6 windows broken by a platypus in a fedora coming through them. Third time this month. Owner says it\'s "a whole thing."', pay: [['700-01', 6]], weather: 'Sunny', hi: 80, lo: 62, photos: ['Window, platypus-shaped hole'], traffic: "ATTENTION_REQUIRED", trafficNote: "Platypus came through a window. Glass on sidewalk; sidewalk closed 2 hours." },
      { activity: '', notes: 'NO WORK DAY', summary: 'Owner\'s latest Inator exploded. From the parking lot we heard "CURSE YOU, PERRY THE PLATYPUS!"', weather: 'Sunny', hi: 78, lo: 61 },
      { activity: 'Self-destruct buttons', summary: 'Installed 3 self-destruct buttons per the owner. Inspector strongly recommends a label, a cover, and fewer than 3.', pay: [['400-01', 3]], weather: 'Overcast', hi: 72, lo: 60, photos: ['Button 2 of 3'], approval: 'changes_requested', comment: { author: 'Moe Ment, P.E.', text: 'Please confirm none of the self-destruct buttons are tied to the structural frame. Again.' }, reply: "Confirmed none are tied to the frame. One is tied to the jingle. The owner says that is worse." },
      { activity: 'Trap doors, jingle', summary: 'Installed 4 platypus-rated trap doors and roughed in the jingle speakers. Now every time the front door opens, a choir sings the company name.', pay: [['500-01', 4], ['600-01', 6000]], weather: 'Sunny', hi: 76, lo: 60, photos: ['Trap door, lobby'], approval: 'approved', tests: [["Other (describe)", "Function test: one platypus dropped in. He was somehow back out before the door closed."]] },
    ],
  },
];

async function seedTutorialData(onProgress) {
  const progress = onProgress || (() => {});
  await saveUserName(TUTORIAL_USER);
  await saveSetting('companyRoomCode', TUTORIAL_COMPANY.code);
  await saveSetting('companyRoomName', TUTORIAL_COMPANY.name);
  await saveSetting('companyRoomIsAdmin', true);
  // Per-person dashboard settings that would otherwise be fetched from the
  // company's cloud record on first visit (sync is off in tutorial mode).
  await saveSetting(managerDashboardExcludedSettingKey(TUTORIAL_USER), []);

  // DEMO-101 goes last so it's the most recently updated project: first on
  // the home page, where the tour points at the first project card.
  const ids = [];
  for (const def of TUTORIAL_OTHER_PROJECTS) ids.push(await seedTutorialProject(def, progress));
  const demoId = await seedTutorialProject(TUTORIAL_DEMO, progress);
  ids.push(demoId);
  await saveSetting(managedProjectsSettingKey(TUTORIAL_USER), ids);
  return demoId;
}

let tutorialPhotoSeed = 0;

// One example project: the project, a report for each of its days (on
// weekdays ending yesterday), and its Pay Apps.
async function seedTutorialProject(def, progress) {
  const nth = def.everyNth || 1;
  const dates = tutorialWeekdays((def.days.length - 1) * nth + 1).filter((d, i, all) => (all.length - 1 - i) % nth === 0);
  const project = {
    id: crypto.randomUUID(),
    companyCode: TUTORIAL_COMPANY.code,
    name: def.name,
    icon: def.icon,
    meta: {
      projectNo: def.projectNo,
      projectName: def.projectName,
      ntpDate: def.ntpDaysAgo ? tutorialIsoDaysAgo(def.ntpDaysAgo) : dates[0],
      contractLength: def.contractLength,
      representative: TUTORIAL_USER,
      peName: def.engineer,
      activity: '', notes: '', workSummaryHeader: '', trafficControlNote: '', workSummary: '',
      controllingItem: '', commentsOnTime: '', controllingItemTimeFrom: '', controllingItemTimeTo: '',
      workingConditions: '', trafficControlSelect: 'IN_PLACE', workBegin: '7:00 AM', workEnd: '3:30 PM',
      weatherDesc: '', tempHigh: '', tempLow: '',
    },
    defaultContractors: def.contractors,
    defaultEquipmentLabels: [],
    payItemCatalog: def.catalog,
    billingEstimates: [],
    requiredFields: [], hiddenFields: [], fieldOrder: [],
    backgroundImage: null, backgroundImageFetched: true,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  await saveProject(project);

  const byItem = new Map(def.catalog.map((it) => [it.itemNumber, it]));
  let previous = null;
  for (let i = 0; i < def.days.length; i++) {
    const day = def.days[i];
    progress(`Writing ${def.projectNo} report ${i + 1} of ${def.days.length}…`);
    const report = await makeBlankReport(i + 1, project, previous);
    report.date = dates[i];
    report.activity = day.activity || '';
    report.notes = day.notes || '';
    report.weatherDesc = day.weather;
    report.tempHigh = String(day.hi);
    report.tempLow = String(day.lo);
    const working = !day.notes;
    // A No Work Day or Weather Day reads the way the editor's buttons
    // write one (report-editor.html applyBlankDay): no work hours, "No work
    // performed" leading the Work Summary, and for weather, the
    // time-charged comment.
    report.workBegin = working ? '7:00 AM' : '';
    report.workEnd = working ? '3:30 PM' : '';
    report.hours = working ? '16' : ''; // both inspectors' hours
    report.inspectors = [{ name: TUTORIAL_USER, hours: working ? '8' : '', timeEntries: [{ start: working ? '07:00' : '', end: working ? '15:30' : '' }] }];
    if (working) report.inspectors.push({ name: def.helpers[i % def.helpers.length], hours: '8', timeEntries: [{ start: '07:00', end: '15:30' }] });
    report.representative = report.inspectors.map((insp) => insp.name).join(', '); // kept in step with the list, as the editor does
    report.trafficControlSelect = working ? (day.traffic || 'IN_PLACE') : null;
    report.commentsOnTime = day.trafficNote || (day.notes === WEATHER_DAY_NOTE ? 'Weather day. Recommend no time charged.' : '');
    report.workSummaryHeader = day.activity || '';
    report.trafficControlNote = day.short || ''; // the line under Work Summary
    report.workSummary = working ? day.summary || ''
      : [`No work performed${day.notes === WEATHER_DAY_NOTE ? ' due to weather' : ''}.`, day.summary].filter(Boolean).join(' ');
    report.controllingItem = day.controlling || '';
    report.workingConditions = day.conditions || '';
    if (day.tests) report.tests = day.tests.map(([name, note]) => ({ name, note }));
    if (working) {
      const crew = def.crew(day);
      report.equipmentRows.forEach((row) => {
        const counts = crew[row.label];
        if (counts) counts.forEach((v, col) => { row.qty[col] = v; });
      });
      day.pay.forEach(([itemNumber, qty, remarks], row) => {
        const cat = byItem.get(itemNumber);
        Object.assign(report.payItems[row], { itemNumber, description: cat.description, unit: cat.unit, qty: String(qty), remarks: remarks || '' });
      });
    }
    for (let p = 0; p < (day.photos || []).length; p++) {
      report.photos[p] = await tutorialPhoto(day.photos[p], tutorialPhotoSeed++);
    }
    if (day.approval) report.approvalStatus = day.approval;
    // The day's comment (or pinned comment) can get a reply from "you"
    // (`reply`), and `comments` adds more threads, each with its own reply.
    const comments = [];
    const addComment = (c, ageMs, reply) => {
      const id = crypto.randomUUID();
      comments.push({ id, author: c.author, text: c.text, createdAt: Date.now() - ageMs, ...(c.page != null ? { pin: { page: c.page, x: c.x, y: c.y } } : {}) });
      if (reply) comments.push({ id: crypto.randomUUID(), author: TUTORIAL_USER, text: reply, createdAt: Date.now() - ageMs + 1800000, parentId: id });
    };
    (day.comments || []).forEach((c) => addComment(c, 2 * 86400000, c.reply));
    if (day.comment) addComment(day.comment, 86400000, day.reply);
    if (day.pinComment) addComment(day.pinComment, 3600000, day.comment ? null : day.reply);
    if (comments.length) report.comments = comments;
    await saveReport(report);
    previous = report;
  }

  if (def.payApps) {
    progress(`Adding ${def.projectNo}'s Pay Apps…`);
    const fresh = await getProject(project.id);
    fresh.billingEstimates = def.payApps(dates);
    await saveProject(fresh);
  }
  return project.id;
}
