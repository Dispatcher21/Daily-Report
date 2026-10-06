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
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const crypto = require('crypto');
const { FieldValue } = require('firebase-admin/firestore');
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
  const byId = new Map((after.comments || []).map((c) => [c.id, c]));
  for (const c of after.comments || []) {
    if (oldIds.has(c.id)) continue;
    const actor = people.resolve(c.authorUid, c.author);
    const parent = c.parentId ? byId.get(c.parentId) : null;
    if (parent) {
      // A reply: whoever wrote the comment it answers, and the owner.
      const parentAuthor = people.resolve(parent.authorUid, parent.author);
      const to = new Set([parentAuthor, author].filter((u) => u && u !== actor));
      events.push({ kind: 'reply', actor, actorName: c.author || 'Someone', text: c.text || '', parentAuthor, parentAuthorName: parent.author || 'someone', to });
    } else {
      const to = new Set([author, ...participants].filter((u) => u && u !== actor));
      events.push({ kind: 'comment', actor, actorName: c.author || 'Someone', text: c.text || '', to });
    }
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

function compose(recipientIsAuthor, thing, events, recipient) {
  const whose = recipientIsAuthor ? 'your' : 'the';
  const replyTarget = (e) => (e.parentAuthor && e.parentAuthor === recipient ? 'your comment' : `${e.parentAuthorName}'s comment`);
  const lead = (e) => e.kind === 'reply'
    ? `${e.actorName} replied to ${replyTarget(e)} on ${whose} ${thing}`
    : `${e.actorName} commented on ${whose} ${thing}`;
  const lines = events.map((e) => e.kind === 'status'
    ? `${e.actorName} ${NOTIFY_STATUSES[e.status]} ${whose} ${thing}.`
    : `${lead(e)}:\n\n    "${e.text}"`);
  const first = events[0];
  const subject = first.kind === 'reply'
    ? `New reply on ${whose} ${thing}`
    : first.kind === 'comment'
      ? `New comment on ${whose} ${thing}`
      : first.status === 'approved' ? `Approved: ${whose} ${thing}` : `Changes requested: ${whose} ${thing}`;
  const text = [...lines, '', 'Open Daily Work Reports to see it or reply.', '', 'You can turn these emails off in Daily Work Reports under Settings, Account.', '', 'Inspector Manager'].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1c2b3a;line-height:1.5">
${events.map((e) => e.kind !== 'status'
    ? `<p>${escapeHtml(lead(e)).replace(escapeHtml(e.actorName), `<strong>${escapeHtml(e.actorName)}</strong>`)}:</p><blockquote style="margin:0 0 14px;padding:8px 12px;border-left:3px solid #1c3d5a;background:#f3f6f9">${escapeHtml(e.text)}</blockquote>`
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
  console.log(`${thing}: ${events.map((e) => (e.kind === 'status' ? `${e.status} by ${e.actorName}` : `${e.kind} by ${e.actorName}`)).join(', ')}. Author: ${author ? people.byUid.get(author).email : 'not found among active members'}. Telling: ${told.join(', ') || 'nobody (no one else involved)'}`);
  const perPerson = new Map();
  for (const e of events) for (const uid of e.to) {
    if (!perPerson.has(uid)) perPerson.set(uid, []);
    perPerson.get(uid).push(e);
  }
  for (const [uid, list] of perPerson) {
    const prefs = (await db().collection('users').doc(uid).get()).data() || {};
    if (prefs.emailComments === false) { console.log(`${people.byUid.get(uid).email} has comment emails turned off`); continue; }
    try {
      await sendEmail(people.byUid.get(uid).email, compose(uid === author, thing, list, uid));
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

// ---------- Password reset by emailed code ----------
//
// "Forgot password?" (or an admin's "Send reset code") emails a 6-digit
// code -- plain words, no link. Codes are stored only as hashes in
// emailCodes (closed to app users by the database rules), expire after 15
// minutes, allow 5 wrong tries, and are rate-limited per address.

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_TRIES = 5;
const RESEND_GAP_MS = 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const MIN_PASSWORD = 8;
const cleanEmail = (email) => String(email || '').trim().toLowerCase();
const codeDocId = (email) => crypto.createHash('sha256').update(`reset:${email}`).digest('hex');
const hashCode = (docId, code) => crypto.createHash('sha256').update(`${docId}:${code}`).digest('hex');

function resetMessage(code, sentByAdmin) {
  const why = sentByAdmin ? `${sentByAdmin} sent you a code to set a new password.` : 'You asked to reset your password.';
  const text = [
    'Hello,', '', why, '', `Your code is: ${code}`, '',
    'On the Daily Work Reports sign-in screen, choose "Forgot password?", then "I have a code", and enter it with your new password. It expires in 15 minutes.',
    '', "If you didn't ask for this, you can ignore this email; your password hasn't changed.", '', 'Inspector Manager',
  ].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1c2b3a;line-height:1.5">
<p>Hello,</p><p>${escapeHtml(why)}</p><p>Your code is:</p>
<p style="font-size:30px;font-weight:bold;letter-spacing:6px;margin:8px 0 16px">${code}</p>
<p>On the Daily Work Reports sign-in screen, choose <strong>Forgot password?</strong>, then <strong>I have a code</strong>, and enter it with your new password. It expires in 15 minutes.</p>
<p style="color:#5b6b7a">If you didn't ask for this, you can ignore this email; your password hasn't changed.</p>
<p>Inspector Manager</p></div>`;
  return { subject: 'Your Daily Work Reports password reset code', text, html };
}

async function issueResetCode(email, sentByAdmin) {
  const id = codeDocId(email);
  const ref = db().collection('emailCodes').doc(id);
  const now = Date.now();
  const prior = (await ref.get()).data() || {};
  const recent = (prior.sends || []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length && now - recent[recent.length - 1] < RESEND_GAP_MS) throw new HttpsError('resource-exhausted', 'A code was just sent. Wait a minute before asking for another.');
  if (recent.length >= MAX_SENDS_PER_HOUR) throw new HttpsError('resource-exhausted', 'Too many codes asked for. Try again in an hour.');
  const exists = await admin.auth().getUserByEmail(email).then(() => true, () => false);
  if (!exists) { await ref.set({ sends: [...recent, now] }, { merge: true }); return; } // say nothing about who has an account
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await ref.set({ codeHash: hashCode(id, code), expiresAt: now + CODE_TTL_MS, tries: 0, sends: [...recent, now] });
  try {
    await sendEmail(email, resetMessage(code, sentByAdmin));
  } catch (err) {
    console.error('reset email failed:', err);
    throw new HttpsError('unavailable', "The email couldn't be sent right now. Try again in a few minutes.");
  }
}

exports.sendResetCode = onCall({ secrets: [RESEND_API_KEY] }, async (request) => {
  const email = cleanEmail(request.data && request.data.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError('invalid-argument', 'Enter a valid email address.');
  await issueResetCode(email, null);
  return { ok: true };
});

// An admin sends a reset code to someone in their company.
exports.adminSendResetCode = onCall({ secrets: [RESEND_API_KEY] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const profile = (await db().collection('users').doc(request.auth.uid).get()).data() || {};
  const code = profile.companyCode;
  const company = code ? db().collection('companies').doc(code) : null;
  const me = company ? (await company.collection('members').doc(request.auth.uid).get()).data() : null;
  if (!me || me.role !== 'admin' || me.status !== 'active') throw new HttpsError('permission-denied', 'Only an admin can do that.');
  const target = (await company.collection('members').doc(String((request.data && request.data.uid) || '')).get()).data();
  if (!target || !target.email) throw new HttpsError('not-found', "That person doesn't have an account email.");
  await issueResetCode(cleanEmail(target.email), me.displayName || 'Your admin');
  console.log(`${me.email} sent a reset code to ${target.email}`);
  return { ok: true, email: target.email };
});

exports.resetPasswordWithCode = onCall(async (request) => {
  const email = cleanEmail(request.data && request.data.email);
  const password = String((request.data && request.data.password) || '');
  if (password.length < MIN_PASSWORD) throw new HttpsError('invalid-argument', `Choose a password with at least ${MIN_PASSWORD} characters.`);
  const id = codeDocId(email);
  const ref = db().collection('emailCodes').doc(id);
  const doc = (await ref.get()).data();
  if (!doc || !doc.codeHash) throw new HttpsError('failed-precondition', 'Ask for a code first.');
  if (Date.now() > doc.expiresAt) throw new HttpsError('deadline-exceeded', 'That code has expired. Ask for a new one.');
  if (doc.tries >= MAX_TRIES) throw new HttpsError('resource-exhausted', 'Too many wrong tries. Ask for a new code.');
  const given = Buffer.from(hashCode(id, String((request.data && request.data.code) || '').replace(/\D/g, '')));
  const wanted = Buffer.from(doc.codeHash);
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) {
    await ref.update({ tries: FieldValue.increment(1) });
    throw new HttpsError('invalid-argument', doc.tries + 1 >= MAX_TRIES ? 'Too many wrong tries. Ask for a new code.' : "That code isn't right. Check the email and try again.");
  }
  await ref.update({ codeHash: FieldValue.delete(), expiresAt: FieldValue.delete(), tries: 0 });
  const user = await admin.auth().getUserByEmail(email).catch(() => null);
  if (!user) throw new HttpsError('not-found', 'No account was found for that email.');
  await admin.auth().updateUser(user.uid, { password });
  return { ok: true };
});

// ---------- weekly roundup ----------

const { onSchedule } = require('firebase-functions/v2/scheduler');
const roundup = require('./roundup');

async function sendRoundup(uid, week, today) {
  const built = await roundup.buildRoundup(db(), uid, week, today);
  if (built.skip) return built;
  await sendEmail(built.to, roundup.composeRoundup(built.msg, escapeHtml));
  return built;
}

// Runs every hour; whoever it is Tuesday 6 AM-ish for (6:30 local) gets
// last week's roundup, once.
exports.weeklyRoundup = onSchedule({ schedule: '30 * * * *', timeZone: 'UTC', secrets: [RESEND_API_KEY] }, async () => {
  const now = new Date();
  const users = await db().collection('users').get();
  for (const doc of users.docs) {
    const profile = doc.data() || {};
    if (!profile.companyCode || profile.weeklyRoundup === false) continue;
    let local;
    try { local = roundup.localParts(now, profile.timeZone || roundup.DEFAULT_TZ); } catch { local = roundup.localParts(now, roundup.DEFAULT_TZ); }
    if (local.weekday !== 'Tue' || local.hour !== 6) continue;
    const week = roundup.lastWeek(local.iso, local.weekday);
    if (profile.roundupSentFor === week.start) continue;
    try {
      const result = await sendRoundup(doc.id, week, local.iso);
      if (result.skip) continue;
      await doc.ref.set({ roundupSentFor: week.start }, { merge: true });
      console.log(`roundup sent to ${result.to} (${result.projectCount} projects)`);
    } catch (err) {
      console.error(`roundup for ${doc.id} failed:`, err);
    }
  }
});

// "Send me a preview now" from Settings: last full week, to yourself.
exports.sendRoundupPreview = onCall({ secrets: [RESEND_API_KEY] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const profile = (await db().collection('users').doc(request.auth.uid).get()).data() || {};
  let local;
  try { local = roundup.localParts(new Date(), profile.timeZone || roundup.DEFAULT_TZ); } catch { local = roundup.localParts(new Date(), roundup.DEFAULT_TZ); }
  const week = roundup.lastWeek(local.iso, local.weekday);
  const result = await sendRoundup(request.auth.uid, week, local.iso);
  if (result.skip === 'no managed projects' || result.skip === 'managed projects not found') {
    throw new HttpsError('failed-precondition', "You aren't managing any projects yet. Choose some on the Manager Dashboard first.");
  }
  if (result.skip) throw new HttpsError('failed-precondition', 'Only active members with an account email get the roundup.');
  return { ok: true, email: result.to, projectCount: result.projectCount };
});
