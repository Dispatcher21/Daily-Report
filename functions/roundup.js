// Weekly roundup email: Tuesdays at 6:30 AM in each person's own time zone,
// covering the previous Monday to Sunday on the projects they chose to
// manage. Laid out like the app (navy header, a card per project), no links.
//
// Per person (users/{uid}): weeklyRoundup (false = off; unset = on when
// they manage any projects), timeZone (picked up from their device),
// roundupSentFor (the week already sent, so the hourly check sends once).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// The app's own pay item / progress math (a copy of quantity-calc.js), so
// percentages and contract values match the dashboards exactly.
const calc = (() => {
  const ctx = {};
  vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, 'lib', 'quantity-calc.js'), 'utf8')}
;this.__x = { aggregatePayItemTotals, fullPayItemCatalogOverview, contractValueSummary, overallPercentComplete, effectivePayItemFlatEntries, isLumpSumUnit, isLumpSumItem };`, ctx);
  return ctx.__x;
})();

const DEFAULT_TZ = 'America/Chicago';

// ---------- dates ----------

function localParts(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return { iso: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday, hour: Number(parts.hour) };
}
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
// The Monday-to-Sunday week before the one containing `todayIso`.
function lastWeek(todayIso, weekday) {
  const thisMonday = addDays(todayIso, -DOW[weekday]);
  return { start: addDays(thisMonday, -7), end: addDays(thisMonday, -1) };
}
const niceDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// ---------- numbers for one project ----------

const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const fmt = (n, digits = 1) => (Math.round(n * 10 ** digits) / 10 ** digits).toLocaleString('en-US');
const money = (n) => (n == null ? null : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));

function hoursByPerson(report) {
  const list = Array.isArray(report.inspectors) && report.inspectors.some((i) => i && (i.name || i.hours))
    ? report.inspectors
    : [{ name: report.representative || report.createdBy, hours: report.hours }];
  return list.filter((i) => i && String(i.name || '').trim()).map((i) => ({ name: String(i.name).trim(), hours: num(i.hours) }));
}

function projectSummary(project, reports, week, today) {
  const live = reports.filter((r) => !r.deleted);
  const weekReports = live.filter((r) => r.date && r.date >= week.start && r.date <= week.end).sort((a, b) => (a.date < b.date ? -1 : 1));
  const people = new Map();
  for (const r of weekReports) {
    const filer = String(r.createdBy || r.representative || 'Unknown').trim();
    if (!people.has(filer)) people.set(filer, { reports: 0, hours: 0 });
    people.get(filer).reports++;
    for (const h of hoursByPerson(r)) {
      if (!people.has(h.name)) people.set(h.name, { reports: 0, hours: 0 });
      people.get(h.name).hours += h.hours;
    }
  }
  const catalog = project.payItemCatalog || [];
  const weekItems = calc.aggregatePayItemTotals(weekReports.flatMap((r) => r.payItems || []), catalog).filter((it) => it.total);
  const overview = calc.fullPayItemCatalogOverview(calc.effectivePayItemFlatEntries(live, project.billingEstimates), catalog);
  const overall = calc.overallPercentComplete(overview);
  const { totalContract, totalEarned } = calc.contractValueSummary(overview);
  const meta = project.meta || {};
  const contractLength = parseInt(meta.contractLength, 10);
  let daysLeft = null;
  let schedule = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(meta.ntpDate || '') && Number.isFinite(contractLength) && contractLength > 0) {
    const used = daysBetween(meta.ntpDate, today);
    daysLeft = contractLength - used;
    if (overall != null) {
      const timeFrac = used / contractLength; // same 3-tier call as the app's dashboards
      schedule = overall + 0.05 >= timeFrac ? 'On schedule' : overall + 0.2 >= timeFrac ? 'Slightly behind' : 'Behind schedule';
    }
  }
  // Heads-up items: contract time running out or gone, behind schedule,
  // and pay items past their planned quantity (to date, all reports).
  const alerts = [];
  if (daysLeft != null && daysLeft < 0) alerts.push(`Past contract time by ${-daysLeft} day${daysLeft === -1 ? '' : 's'}`);
  else if (daysLeft != null && daysLeft <= 30) alerts.push(`${daysLeft} day${daysLeft === 1 ? '' : 's'} left on the contract`);
  if (schedule && schedule !== 'On schedule') {
    alerts.push(`${schedule}: ${Math.round(overall * 100)}% complete with ${Math.round((daysBetween(meta.ntpDate, today) / contractLength) * 100)}% of contract time used`);
  }
  const overruns = overview.filter((it) => it.planned && it.total > it.planned && !calc.isLumpSumItem(it));
  overruns.slice(0, 5).forEach((it) => alerts.push(`Item ${it.itemNumber}${it.description ? ` ${it.description}` : ''} is over plan: ${fmt(it.total, 2)} of ${fmt(it.planned, 2)} ${it.unit || ''} (${Math.round((it.total / it.planned) * 100)}%)`.replace(/ +\(/, ' (')));
  if (overruns.length > 5) alerts.push(`and ${overruns.length - 5} more pay items over plan`);
  const counts = { approved: 0, changes_requested: 0, pending: 0 };
  weekReports.forEach((r) => { counts[r.approvalStatus in counts ? r.approvalStatus : 'pending']++; });
  return {
    name: project.name || 'Untitled project', projectNo: meta.projectNo || '',
    reportCount: weekReports.length,
    totalHours: [...people.values()].reduce((s, p) => s + p.hours, 0),
    people: [...people.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.hours - a.hours || b.reports - a.reports),
    payItems: weekItems.map((it) => ({ itemNumber: it.itemNumber, description: it.description, unit: it.unit, total: it.total })),
    overall, totalContract, totalEarned, daysLeft, schedule, counts, alerts,
  };
}

// ---------- email ----------

const NAVY = '#1c3d5a';
const scheduleColor = { 'On schedule': '#2e7d32', 'Slightly behind': '#b26a00', 'Behind schedule': '#c62828' };

function statCell(label, value) {
  return `<td style="padding:8px 6px;text-align:center;border:1px solid #e3e8ee;border-radius:6px;background:#f6f8fa;width:25%">
<div style="font-size:20px;font-weight:bold;color:${NAVY}">${value}</div><div style="font-size:11px;color:#5b6b7a;text-transform:uppercase;letter-spacing:.5px">${label}</div></td>`;
}

function projectCard(p, esc) {
  const pct = p.overall == null ? '&ndash;' : `${Math.round(p.overall * 100)}%`;
  const days = p.daysLeft == null ? '&ndash;' : p.daysLeft >= 0 ? String(p.daysLeft) : `${-p.daysLeft} over`;
  const people = p.people.length
    ? p.people.map((x) => `<tr><td style="padding:3px 0">${esc(x.name)}</td><td style="padding:3px 0;text-align:right;color:#5b6b7a">${x.reports ? `${x.reports} report${x.reports === 1 ? '' : 's'}` : ''}</td><td style="padding:3px 0 3px 12px;text-align:right;font-weight:bold">${fmt(x.hours)} hrs</td></tr>`).join('')
    : '<tr><td style="color:#5b6b7a">No reports filed this week.</td></tr>';
  const items = p.payItems.length ? `
<div style="font-size:12px;font-weight:bold;color:#5b6b7a;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 4px">Pay items this week</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;border-collapse:collapse">
${p.payItems.slice(0, 12).map((it) => `<tr><td style="padding:3px 8px 3px 0;color:#5b6b7a;white-space:nowrap">${esc(it.itemNumber)}</td><td style="padding:3px 0">${esc(it.description || '')}</td><td style="padding:3px 0 3px 12px;text-align:right;white-space:nowrap;font-weight:bold">${fmt(it.total, 2)} ${esc(it.unit || '')}</td></tr>`).join('')}
${p.payItems.length > 12 ? `<tr><td colspan="3" style="color:#5b6b7a;padding-top:3px">and ${p.payItems.length - 12} more</td></tr>` : ''}
</table>` : '';
  const attention = [
    p.counts.changes_requested ? `${p.counts.changes_requested} with changes requested` : '',
    p.counts.pending ? `${p.counts.pending} waiting for review` : '',
  ].filter(Boolean).join(' &middot; ');
  return `
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;border:1px solid #dde3ea;border-radius:10px;margin:0 0 16px;border-collapse:separate">
<tr><td style="background:${NAVY};color:#ffffff;padding:12px 16px;border-radius:10px 10px 0 0">
<div style="font-size:17px;font-weight:bold">${esc(p.name)}</div>
${p.projectNo || p.schedule ? `<div style="font-size:12px;opacity:.85">${esc(p.projectNo)}${p.projectNo && p.schedule ? ' &middot; ' : ''}${p.schedule ? `<span style="color:#ffffff;background:${scheduleColor[p.schedule]};padding:1px 7px;border-radius:9px">${p.schedule}</span>` : ''}</div>` : ''}
</td></tr>
<tr><td style="padding:14px 16px">
${p.alerts.length ? `<div style="background:#fff6e5;border:1px solid #f0d199;border-radius:8px;padding:8px 12px;margin:0 0 10px;font-size:13px;color:#7a4a00"><div style="font-weight:bold;margin-bottom:2px">Heads up</div>${p.alerts.map((a) => `<div>${esc(a)}</div>`).join('')}</div>` : ''}
<table role="presentation" width="100%" cellspacing="6" cellpadding="0"><tr>
${statCell('Reports', p.reportCount)}${statCell('Hours', fmt(p.totalHours))}${statCell('Complete', pct)}${statCell('Days left', days)}
</tr></table>
${p.totalContract ? `<div style="font-size:13px;color:#5b6b7a;margin:6px 0 0">Earned ${money(p.totalEarned)} of ${money(p.totalContract)} contract value</div>` : ''}
${attention ? `<div style="font-size:13px;margin:6px 0 0;color:#b26a00">This week's reports: ${attention}</div>` : ''}
<div style="font-size:12px;font-weight:bold;color:#5b6b7a;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 4px">Who worked</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px">${people}</table>
${items}
</td></tr></table>`;
}

function composeRoundup({ name, companyName, week, projects, allProjects }, esc) {
  const range = `${niceDate(week.start)} to ${niceDate(week.end)}`;
  const totalReports = projects.reduce((s, p) => s + p.reportCount, 0);
  const totalHours = projects.reduce((s, p) => s + p.totalHours, 0);
  const html = `<div style="background:#eef2f6;padding:20px 0;font-family:Arial,Helvetica,sans-serif;color:#1c2b3a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%">
<tr><td style="background:${NAVY};color:#ffffff;padding:18px 20px;border-radius:10px">
<div style="font-size:12px;opacity:.85;text-transform:uppercase;letter-spacing:1px">Weekly Roundup${companyName ? ` &middot; ${esc(companyName)}` : ''}</div>
<div style="font-size:22px;font-weight:bold;margin-top:2px">${range}</div>
<div style="font-size:14px;opacity:.9;margin-top:6px">${totalReports} report${totalReports === 1 ? '' : 's'} &middot; ${fmt(totalHours)} hours &middot; ${projects.length} ${allProjects ? 'company ' : ''}project${projects.length === 1 ? '' : 's'}${allProjects ? '' : ' you manage'}</div>
</td></tr>
<tr><td style="padding:16px 0 0">${projects.map((p) => projectCard(p, esc)).join('')}</td></tr>
<tr><td style="font-size:12px;color:#5b6b7a;padding:4px 6px 0">Hi ${esc(name || '')}, this covers ${allProjects ? 'every project in your company' : "the projects you've chosen to manage"} in Daily Work Reports. ${allProjects ? 'Switch back to just your managed projects' : 'Change which ones'}, or turn this email off, in the app under Settings.<br><br>Inspector Manager</td></tr>
</table></td></tr></table></div>`;
  const text = [`Weekly Roundup: ${range}${companyName ? ` (${companyName})` : ''}`, `${totalReports} report${totalReports === 1 ? '' : 's'}, ${fmt(totalHours)} hours, ${projects.length} ${allProjects ? 'company ' : ''}project${projects.length === 1 ? '' : 's'}${allProjects ? '' : ' you manage'}`, '',
    ...projects.flatMap((p) => [
      `${p.name}${p.projectNo ? ` (${p.projectNo})` : ''}`,
      `  Reports: ${p.reportCount}   Hours: ${fmt(p.totalHours)}   Complete: ${p.overall == null ? '-' : `${Math.round(p.overall * 100)}%`}   Days left: ${p.daysLeft == null ? '-' : p.daysLeft}${p.schedule ? `   (${p.schedule})` : ''}`,
      ...p.alerts.map((a) => `  Heads up: ${a}`),
      ...p.people.map((x) => `  ${x.name}: ${x.reports ? `${x.reports} reports, ` : ''}${fmt(x.hours)} hrs`),
      ...p.payItems.slice(0, 12).map((it) => `  ${it.itemNumber} ${it.description || ''}: ${fmt(it.total, 2)} ${it.unit || ''}`),
      '',
    ]),
    'Change which projects, or turn this email off, in Daily Work Reports under Settings.', '', 'Inspector Manager'].join('\n');
  return { subject: `Weekly Roundup: ${range}`, text, html };
}

// ---------- building one person's roundup ----------

const layoutDocId = (name) => String(name).trim().replace(/\//g, '_').slice(0, 300);

// Returns { to, msg, projectCount } or null (with a reason) if nothing to send.
async function buildRoundup(db, uid, week, today) {
  const profile = (await db.collection('users').doc(uid).get()).data() || {};
  const code = profile.companyCode;
  if (!code) return { skip: 'not in a company' };
  const company = db.collection('companies').doc(code);
  const member = (await company.collection('members').doc(uid).get()).data();
  if (!member || member.status !== 'active' || !member.email) return { skip: 'not an active member' };
  const name = member.displayName || profile.displayName || '';
  const layout = name ? (await company.collection('userLayouts').doc(layoutDocId(name)).get()).data() : null;
  // Admins can ask for every project in the company instead.
  const allProjects = member.role === 'admin' && profile.roundupAllProjects === true;
  let projectIds = allProjects
    ? (await company.collection('projects').get()).docs.map((d) => d.id)
    : (layout && Array.isArray(layout.managedProjectIds)) ? layout.managedProjectIds : [];
  if (member.role !== 'admin' && Array.isArray(member.projectIds)) projectIds = projectIds.filter((id) => member.projectIds.includes(id));
  if (!projectIds.length) return { skip: allProjects ? 'managed projects not found' : 'no managed projects' };
  const companyData = (await company.get()).data() || {};
  const projects = [];
  for (const id of projectIds) {
    const snap = await company.collection('projects').doc(id).get();
    if (!snap.exists) continue;
    const reports = (await company.collection('reports').where('projectId', '==', id).get()).docs.map((d) => d.data());
    projects.push(projectSummary(snap.data(), reports, week, today));
  }
  if (!projects.length) return { skip: 'managed projects not found' };
  projects.sort((a, b) => b.reportCount - a.reportCount || a.name.localeCompare(b.name));
  return { to: member.email, projectCount: projects.length, msg: { name, companyName: companyData.name || '', week, projects, allProjects } };
}

module.exports = { localParts, lastWeek, buildRoundup, composeRoundup, DEFAULT_TZ };
