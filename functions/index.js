// Comment notification emails. When someone comments on a daily report or
// a Pay App, or approves it / asks for changes, the people involved get a
// short email through Resend: the report's or Pay App's author, plus anyone
// who already commented on it -- never the person who did it, and never
// anyone who turned emails off in Settings (users/{uid}.emailComments).
//
// Plain words only, no links: work email filters treat link emails from a
// new sender as phishing. Only people with an account get emails (that's
// where the address comes from).

const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 5 });

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const MAIL_FROM = defineString('MAIL_FROM');
const EMULATED = process.env.FUNCTIONS_EMULATOR === 'true';
const NOTIFY_STATUSES = { approved: 'approved', changes_requested: 'asked for changes on' };

const db = () => admin.firestore();
const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The company's people, and a way to find one by account (or, for older
// records from before accounts, by the name they go by).
async function loadPeople(code) {
  const snap = await db().collection('companies').doc(code).collection('members').get();
  const byUid = new Map();
  snap.forEach((d) => { const m = d.data(); if (m.status === 'active' && m.email) byUid.set(d.id, m); });
  // By name only when exactly one person goes by it -- two people with the
  // same name could otherwise get each other's emails (or none).
  const resolve = (uid, name) => {
    if (uid && byUid.has(uid)) return uid;
    const wanted = String(name || '').trim().toLowerCase();
    if (!wanted) return null;
    const matches = [...byUid].filter(([, m]) => String(m.displayName || '').trim().toLowerCase() === wanted);
    return matches.length === 1 ? matches[0][0] : null;
  };
  return { byUid, resolve };
}

// From a before/after pair of things with a comment thread: what's new
// (comments, approval changes) and who should hear about each.
function whatHappened(before, after, people) {
  const events = [];
  const author = people.resolve(after.createdByUid, after.createdBy);
  const oldIds = new Set((before.comments || []).map((c) => c.id));
  const participants = new Set((before.comments || []).map((c) => people.resolve(c.authorUid, c.author)).filter(Boolean));
  for (const c of after.comments || []) {
    if (oldIds.has(c.id)) continue;
    const actor = people.resolve(c.authorUid, c.author);
    const to = new Set([author, ...participants].filter((u) => u && u !== actor));
    events.push({ kind: 'comment', actor, actorName: c.author || 'Someone', text: c.text || '', to });
    if (actor) participants.add(actor);
  }
  if (after.approvalStatus !== before.approvalStatus && NOTIFY_STATUSES[after.approvalStatus]) {
    const actor = people.resolve(after.approvalByUid, after.approvalBy);
    if (author && author !== actor) {
      events.push({ kind: 'status', status: after.approvalStatus, actor, actorName: after.approvalBy || 'A manager', to: new Set([author]) });
    }
  }
  return { events, author };
}

function compose(recipientIsAuthor, thing, events) {
  const whose = recipientIsAuthor ? 'your' : 'the';
  const lines = events.map((e) => e.kind === 'comment'
    ? `${e.actorName} commented on ${whose} ${thing}:\n\n    "${e.text}"`
    : `${e.actorName} ${NOTIFY_STATUSES[e.status]} ${whose} ${thing}.`);
  const first = events[0];
  const subject = first.kind === 'comment'
    ? `New comment on ${whose} ${thing}`
    : first.status === 'approved' ? `Approved: ${whose} ${thing}` : `Changes requested: ${whose} ${thing}`;
  const text = [...lines, '', 'Open Daily Work Reports to see it or reply.', '', 'You can turn these emails off in Daily Work Reports under Settings, Account.', '', 'Inspector Manager'].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1c2b3a;line-height:1.5">
${events.map((e) => e.kind === 'comment'
    ? `<p><strong>${escapeHtml(e.actorName)}</strong> commented on ${whose} ${escapeHtml(thing)}:</p><blockquote style="margin:0 0 14px;padding:8px 12px;border-left:3px solid #1c3d5a;background:#f3f6f9">${escapeHtml(e.text)}</blockquote>`
    : `<p><strong>${escapeHtml(e.actorName)}</strong> ${NOTIFY_STATUSES[e.status]} ${whose} ${escapeHtml(thing)}.</p>`).join('\n')}
<p>Open Daily Work Reports to see it or reply.</p>
<p style="color:#5b6b7a;font-size:13px">You can turn these emails off in Daily Work Reports under Settings, Account.</p>
<p>Inspector Manager</p>
</div>`;
  return { subject, text, html };
}

async function sendEmail(to, msg) {
  if (EMULATED) {
    await db().collection('devOutbox').add({ to, ...msg, at: Date.now() });
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY.value()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM.value(), to: [to], subject: msg.subject, text: msg.text, html: msg.html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

// One email per person per change, grouping everything they need to hear.
async function notify(people, author, thing, events) {
  // One line per change in the function log: what happened and who was told.
  const told = [...new Set(events.flatMap((e) => [...e.to]))].map((u) => people.byUid.get(u).email);
  console.log(`${thing}: ${events.map((e) => (e.kind === 'comment' ? `comment by ${e.actorName}` : `${e.status} by ${e.actorName}`)).join(', ')}. Author: ${author ? people.byUid.get(author).email : 'not found among active members'}. Telling: ${told.join(', ') || 'nobody (no one else involved)'}`);
  const perPerson = new Map();
  for (const e of events) for (const uid of e.to) {
    if (!perPerson.has(uid)) perPerson.set(uid, []);
    perPerson.get(uid).push(e);
  }
  for (const [uid, list] of perPerson) {
    const prefs = (await db().collection('users').doc(uid).get()).data() || {};
    if (prefs.emailComments === false) { console.log(`${people.byUid.get(uid).email} has comment emails turned off`); continue; }
    try {
      await sendEmail(people.byUid.get(uid).email, compose(uid === author, thing, list));
      console.log(`emailed ${people.byUid.get(uid).email}`);
    } catch (err) {
      console.error('notification email failed:', err);
    }
  }
}

const dateLabel = (d) => (d ? ` (${d})` : '');

exports.onReportComment = onDocumentUpdated({ document: 'companies/{code}/reports/{reportId}', secrets: [RESEND_API_KEY] }, async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  if ((after.comments || []).length === (before.comments || []).length && after.approvalStatus === before.approvalStatus) return;
  const people = await loadPeople(event.params.code);
  const { events, author } = whatHappened(before, after, people);
  if (!events.length) { console.log(`report ${event.params.reportId} changed, but there was no one to tell`); return; }
  const project = after.projectId ? (await db().collection('companies').doc(event.params.code).collection('projects').doc(after.projectId).get()).data() : null;
  const thing = `daily report${after.reportNo != null ? ` #${after.reportNo}` : ''}${project && project.name ? ` for ${project.name}` : ''}${dateLabel(after.date)}`;
  await notify(people, author, thing, events);
});

exports.onPayAppComment = onDocumentUpdated({ document: 'companies/{code}/projects/{projectId}', secrets: [RESEND_API_KEY] }, async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  const oldById = new Map((before.billingEstimates || []).map((e) => [e.id, e]));
  const changed = (after.billingEstimates || []).filter((e) => {
    const old = oldById.get(e.id) || {};
    return (e.comments || []).length !== (old.comments || []).length || e.approvalStatus !== old.approvalStatus;
  });
  if (!changed.length) return;
  const people = await loadPeople(event.params.code);
  for (const estimate of changed) {
    const { events, author } = whatHappened(oldById.get(estimate.id) || {}, estimate, people);
    if (!events.length) continue;
    const thing = `Pay App${estimate.estimateNo != null ? ` #${estimate.estimateNo}` : ''}${after.name ? ` for ${after.name}` : ''}${dateLabel(estimate.date)}`;
    await notify(people, author, thing, events);
  }
});
