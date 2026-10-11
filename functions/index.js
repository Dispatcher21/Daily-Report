// Comment notification emails. When someone comments on a daily report or
// a Pay App, or approves it / asks for changes, the people involved get a
// short email through Resend: the report's or Pay App's author, plus anyone
// who already commented on it -- never the person who did it, and never
// anyone who turned emails off in Settings (users/{uid}.emailComments).
//
// Plain words only, no links: work email filters treat link emails from a
// new sender as phishing. Only people with an account get emails (that's
// where the address comes from).

const { onDocumentUpdated, onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
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
  return { code, byUid, resolve };
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
      await recordProblem(people.code, `An email to ${people.byUid.get(uid).email} about ${thing} couldn't be sent (${err.message}).`);
    }
  }
}

const dateLabel = (d) => (d ? ` (${d})` : '');

exports.onReportComment = onDocumentUpdated({ document: 'companies/{code}/reports/{reportId}', secrets: [RESEND_API_KEY] }, async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  if (after.deleted && !before.deleted) {
    const project = after.projectId ? (await db().collection('companies').doc(event.params.code).collection('projects').doc(after.projectId).get()).data() : null;
    await queueAlert(event.params.code, 'security', `${after.deletedBy || 'Someone'} deleted daily report${after.reportNo != null ? ` #${after.reportNo}` : ''}${project && project.name ? ` for ${project.name}` : ''}${dateLabel(after.date)}. It can be restored from the Trash.`);
  }
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
  const given = Buffer.from(hashCode(id, String((request.data && request.data.code) || '').replace(/\D/g, '')));
  // Checked and counted in one transaction, so guesses sent all at once
  // each use up a try instead of all reading "no wrong tries yet".
  const outcome = await db().runTransaction(async (tx) => {
    const doc = (await tx.get(ref)).data();
    if (!doc || !doc.codeHash) return 'none';
    if (Date.now() > doc.expiresAt) return 'expired';
    if ((doc.tries || 0) >= MAX_TRIES) return 'locked';
    const wanted = Buffer.from(doc.codeHash);
    if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) {
      tx.update(ref, { tries: (doc.tries || 0) + 1 });
      return (doc.tries || 0) + 1 >= MAX_TRIES ? 'locked' : 'wrong';
    }
    tx.update(ref, { codeHash: FieldValue.delete(), expiresAt: FieldValue.delete(), tries: 0 });
    return 'ok';
  });
  if (outcome === 'none') throw new HttpsError('failed-precondition', 'Ask for a code first.');
  if (outcome === 'expired') throw new HttpsError('deadline-exceeded', 'That code has expired. Ask for a new one.');
  if (outcome === 'locked') throw new HttpsError('resource-exhausted', 'Too many wrong tries. Ask for a new code.');
  if (outcome === 'wrong') throw new HttpsError('invalid-argument', "That code isn't right. Check the email and try again.");
  const user = await admin.auth().getUserByEmail(email).catch(() => null);
  if (!user) throw new HttpsError('not-found', 'No account was found for that email.');
  await admin.auth().updateUser(user.uid, { password });
  await sendPasswordChangedNotice(email, 'with an emailed reset code');
  return { ok: true };
});

// ---------- weekly roundup ----------

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
      await recordProblem(profile.companyCode, `The weekly roundup for ${profile.email || profile.displayName || 'a member'} couldn't be sent (${err.message}).`);
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

// ---------- account emails ----------
// Join requests (to admins), "you're approved", invites, and a heads-up
// whenever a password changes. Same plain, link-free style as the rest.

const ROLE_NAMES = { admin: 'Admin', manager: 'Manager', inspector: 'Inspector' };

function plainMessage(subject, paragraphs, footer) {
  const text = ['Hello,', '', ...paragraphs.flatMap((p) => [p, '']), ...(footer ? [footer, ''] : []), 'Inspector Manager'].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1c2b3a;line-height:1.5">
<p>Hello,</p>${paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')}
${footer ? `<p style="color:#5b6b7a;font-size:13px">${escapeHtml(footer)}</p>` : ''}
<p>Inspector Manager</p></div>`;
  return { subject, text, html };
}

async function trySend(to, msg, what, code) {
  try {
    await sendEmail(to, msg);
    console.log(`${what}: emailed ${to}`);
  } catch (err) {
    console.error(`${what} email to ${to} failed:`, err);
    if (code) await recordProblem(code, `The ${what} email to ${to} couldn't be sent (${err.message}).`);
  }
}

async function sendPasswordChangedNotice(email, how) {
  await trySend(email, plainMessage('Your Daily Work Reports password was changed', [
    `The password for your Daily Work Reports account (${email}) was just changed ${how}.`,
    "If that was you, there's nothing else to do.",
    `If it wasn't, choose "Forgot password?" on the Daily Work Reports sign-in screen to set a new one right away, and let your company's admin know.`,
  ]), 'password changed notice');
}

// The app calls this right after changing a password in Settings (the
// change itself happens in the browser, so the server can't see it).
exports.passwordChangedNotice = onCall({ secrets: [RESEND_API_KEY] }, async (request) => {
  if (!request.auth || !request.auth.token.email) throw new HttpsError('unauthenticated', 'Sign in first.');
  // Only right after a sign-in or password change, which refreshes the token.
  if (Date.now() / 1000 - request.auth.token.auth_time > 10 * 60) return { ok: false };
  const ref = db().collection('users').doc(request.auth.uid);
  const last = ((await ref.get()).data() || {}).passwordNoticeAt || 0;
  if (Date.now() - last < 60 * 1000) return { ok: false };
  await ref.set({ passwordNoticeAt: Date.now() }, { merge: true });
  await sendPasswordChangedNotice(cleanEmail(request.auth.token.email), 'in Settings');
  return { ok: true };
});

// Someone asks to join (admins hear about it), or an admin approves them
// (they hear about it).
exports.onMemberWritten = onDocumentWritten({ document: 'companies/{code}/members/{uid}', secrets: [RESEND_API_KEY] }, async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  await memberSecurityAlerts(event.params.code, event.params.uid, before, after);
  if (!after) return;
  const joining = after.status === 'pending' && (!before || before.status !== 'pending');
  const approved = before && before.status === 'pending' && after.status === 'active' && after.email;
  if (!joining && !approved) return; // most changes (names, roles) need no email
  const company = db().collection('companies').doc(event.params.code);
  const companyName = ((await company.get()).data() || {}).name || 'your company';
  const who = after.displayName ? `${after.displayName}${after.email ? ` (${after.email})` : after.noAccount ? ' (no account, one device)' : ''}` : (after.email || 'Someone');

  if (joining) {
    const admins = (await company.collection('members').where('role', '==', 'admin').get()).docs
      .map((d) => ({ uid: d.id, ...d.data() })).filter((m) => m.status === 'active' && m.email);
    for (const a of admins) {
      const prefs = (await db().collection('users').doc(a.uid).get()).data() || {};
      if (prefs.emailJoinRequests === false) continue;
      await trySend(a.email, plainMessage(`${after.displayName || after.email || 'Someone'} asked to join ${companyName}`, [
        `${who} asked to join ${companyName} on Daily Work Reports.`,
        'To approve or decline, open Daily Work Reports and go to Settings, Company, Team.',
      ], 'You get this because you are an admin. You can turn these emails off in Daily Work Reports under Settings, Account.'), 'join request', event.params.code);
    }
  }

  if (approved) {
    await trySend(after.email, plainMessage(`You're approved to join ${companyName}`, [
      `Good news: you've been approved to join ${companyName} on Daily Work Reports as ${/^[aeiou]/i.test(ROLE_NAMES[after.role] || 'Inspector') ? 'an' : 'a'} ${ROLE_NAMES[after.role] || 'Inspector'}.`,
      'Open Daily Work Reports and sign in with this email address to get started.',
    ]), 'approved', event.params.code);
  }
});

// An admin pre-approves an email: that person gets told how to join.
exports.onInviteCreated = onDocumentCreated({ document: 'invites/{email}', secrets: [RESEND_API_KEY] }, async (event) => {
  const invite = event.data.data() || {};
  const email = cleanEmail(event.params.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  const companyName = invite.companyName || 'a company';
  const inviter = invite.invitedBy || 'An admin';
  const role = ROLE_NAMES[invite.role] || 'Inspector';
  await trySend(email, plainMessage(`You're invited to join ${companyName} on Daily Work Reports`, [
    `${inviter} invited you to join ${companyName} on Daily Work Reports as ${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${role}.`,
    `To join, go to inspector-manager.com, choose Create Account, and sign up with this email address (${email}). Then enter your company's password, which ${inviter} will give you.`,
  ], "If you weren't expecting this, you can ignore it."), 'invite', invite.companyCode);
});

// ---------- admin alerts ----------
// Security changes (new admins, people removed, sign-in settings, passwords,
// deletions) and problems (uploads that keep failing, emails that couldn't
// be sent) are queued in adminAlerts (server-only), then emailed to each
// company's admins every 15 minutes, grouped. Problems go out at most once
// a day per company. Admins choose which they get in Settings, Account
// (users/{uid}.emailSecurityAlerts / emailProblemAlerts).

const PERMISSION_NAMES = {
  membersCanEditOwnReports: 'edit/delete their own reports',
  membersCanEditAnyReport: 'edit/delete any report',
  membersCanEditProjects: 'edit projects',
  membersCanCreateProjects: 'create projects',
  membersCanViewManagerDashboard: 'view the Manager Dashboard',
  membersCanApproveReports: 'approve/request changes on reports',
  membersCanApprovePayApps: 'approve/request changes on Pay Apps',
  membersCanCommentReports: 'comment on reports',
  membersCanCommentPayApps: 'comment on Pay Apps',
};
const PROBLEM_GAP_MS = 24 * 60 * 60 * 1000;

async function queueAlert(code, kind, text) {
  if (!code) return;
  const ref = db().collection('adminAlerts');
  if (kind === 'problem') {
    // The same problem again the same day only bumps a count.
    const id = crypto.createHash('sha256').update(`${code}:${text}:${new Date().toISOString().slice(0, 10)}`).digest('hex');
    try {
      await ref.doc(id).create({ code, kind, text, at: Date.now(), sent: false, count: 1 });
    } catch (err) {
      if (err.code === 6) await ref.doc(id).update({ count: FieldValue.increment(1) }).catch(() => {});
      else console.error('queueAlert:', err);
    }
    return;
  }
  await ref.add({ code, kind, text, at: Date.now(), sent: false });
}
const recordProblem = (code, text) => queueAlert(code, 'problem', text).catch((err) => console.error('recordProblem:', err));

const personLabel = (m) => (m && (m.displayName ? `${m.displayName}${m.email ? ` (${m.email})` : ''}` : m.email)) || 'Someone';

async function memberSecurityAlerts(code, uid, before, after) {
  if (!before && after && 'movedTo' in after) return; // copied over by a company password change
  // Who made the change, when the app recorded it on this write.
  const by = after && after.changedBy && (!before || !before.changedBy || before.changedBy.at !== after.changedBy.at) ? after.changedBy.name : null;
  if (after && after.role === 'admin' && after.status === 'active' && (!before || before.role !== 'admin' || before.status !== 'active')) {
    if (!before) {
      const company = (await db().collection('companies').doc(code).get()).data() || {};
      if (company.createdByUid === uid) return; // the company's creator
    }
    await queueAlert(code, 'security', `${personLabel(after)} ${before ? 'is now an admin' : 'joined as an admin'}${by ? `, made one by ${by}` : ', using the admin password'}.`);
  }
  if (before && before.status === 'active' && after && after.status === 'disabled') {
    await queueAlert(code, 'security', `${personLabel(after)} had their access turned off${by ? ` by ${by}` : ''}.`);
  }
  if (before && before.status === 'active' && !after && !before.movedTo) {
    await queueAlert(code, 'security', `${personLabel(before)} was removed from the team.`);
  }
}

exports.onCompanyUpdated = onDocumentUpdated('companies/{code}', async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  const code = event.params.code;
  const onOff = (v) => (v ? 'on' : 'off');
  if (!!before.accountsRequired !== !!after.accountsRequired) await queueAlert(code, 'security', `"Require everyone to sign in" was turned ${onOff(after.accountsRequired)}.`);
  if (!!before.requireApproval !== !!after.requireApproval) await queueAlert(code, 'security', `Approving new members was turned ${onOff(after.requireApproval)}.`);
  // (A string is the old hash format; upgrading it on sign-in isn't a change.)
  if (before.adminPasswordHash && typeof before.adminPasswordHash === 'object'
    && JSON.stringify(before.adminPasswordHash) !== JSON.stringify(after.adminPasswordHash)) await queueAlert(code, 'security', 'The admin password was changed.');
  if (!before.passwordChangedAt && after.passwordChangedAt) {
    // Tell the company where everyone moved to (its admins are the ones there now).
    const moved = (await event.data.after.ref.collection('members').get()).docs.map((d) => d.data().movedTo).find(Boolean);
    await queueAlert(moved || code, 'security', 'The company password was changed. Everyone moves to the new one automatically the next time they open the app.');
  }
  const perms = (d) => d.rolePermissions || {};
  for (const role of ['manager', 'inspector']) {
    for (const key of Object.keys(PERMISSION_NAMES)) {
      const was = (perms(before)[role] || {})[key];
      const now = (perms(after)[role] || {})[key];
      if (now !== undefined && was !== now) await queueAlert(code, 'security', `Roles: ${ROLE_NAMES[role]}s ${now ? 'can now' : 'can no longer'} ${PERMISSION_NAMES[key]}.`);
    }
  }
});

exports.onProjectDeleted = onDocumentCreated('companies/{code}/deletedProjects/{projectId}', async (event) => {
  const d = event.data.data() || {};
  await queueAlert(event.params.code, 'security', `${d.deletedBy || 'Someone'} deleted the project ${d.name ? `"${String(d.name).slice(0, 120)}"` : event.params.projectId}.`);
});

// The app reports problems it hits (uploads the server keeps refusing) here.
exports.onProblemReported = onDocumentCreated('companies/{code}/problems/{id}', async (event) => {
  const d = event.data.data() || {};
  const by = String(d.by || 'Someone').slice(0, 80);
  await recordProblem(event.params.code, `${by}'s device: ${String(d.text || 'something went wrong').slice(0, 400)}`);
  await event.data.ref.delete().catch(() => {});
});

const alertTime = (at, tz) => {
  try { return new Date(at).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return new Date(at).toLocaleString('en-US', { timeZone: roundup.DEFAULT_TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
};

function alertMessage(companyName, security, problems, tz) {
  const MAX = 25;
  const lines = (list) => list.slice(0, MAX).map((a) => `${alertTime(a.at, tz)}: ${a.text}${a.count > 1 ? ` (${a.count} times)` : ''}`)
    .concat(list.length > MAX ? [`and ${list.length - MAX} more`] : []);
  const subject = security.length && problems.length ? `Security changes and problems at ${companyName}`
    : security.length ? (security.length === 1 ? `Security alert at ${companyName}` : `${security.length} security changes at ${companyName}`)
      : `Problems at ${companyName} in Daily Work Reports`;
  const sections = [];
  if (security.length) sections.push(['Security changes', lines(security), 'If any of these is a surprise, check Settings, Company and the activity log.']);
  if (problems.length) sections.push(['Problems', lines(problems), 'Problem emails come at most once a day. Uploads that failed are retried when that person taps Sync Now.']);
  const text = ['Hello,', '', `Here's what happened at ${companyName} in Daily Work Reports:`, '',
    ...sections.flatMap(([h, l, n]) => [h.toUpperCase(), ...l.map((x) => `- ${x}`), n, '']),
    'You get these because you are an admin. Choose which admin emails you get in Daily Work Reports under Settings, Account.', '', 'Inspector Manager'].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1c2b3a;line-height:1.5">
<p>Hello,</p><p>Here's what happened at <strong>${escapeHtml(companyName)}</strong> in Daily Work Reports:</p>
${sections.map(([h, l, n]) => `<p style="margin:16px 0 4px;font-size:12px;font-weight:bold;color:#5b6b7a;text-transform:uppercase;letter-spacing:.5px">${h}</p>
<ul style="margin:0;padding-left:20px">${l.map((x) => `<li style="margin:3px 0">${escapeHtml(x)}</li>`).join('')}</ul>
<p style="color:#5b6b7a;font-size:13px;margin:6px 0 0">${escapeHtml(n)}</p>`).join('\n')}
<p style="color:#5b6b7a;font-size:13px;margin-top:18px">You get these because you are an admin. Choose which admin emails you get in Daily Work Reports under Settings, Account.</p>
<p>Inspector Manager</p></div>`;
  return { subject, text, html };
}

async function sendAdminAlerts() {
  const pending = await db().collection('adminAlerts').where('sent', '==', false).limit(1000).get();
  const byCompany = new Map();
  pending.forEach((d) => {
    const a = { ref: d.ref, ...d.data() };
    if (!byCompany.has(a.code)) byCompany.set(a.code, []);
    byCompany.get(a.code).push(a);
  });
  const now = Date.now();
  for (const [code, list] of byCompany) {
    const companyRef = db().collection('companies').doc(code);
    const company = (await companyRef.get()).data() || {};
    const problemsDue = now - (company.lastProblemEmailAt || 0) >= PROBLEM_GAP_MS;
    const security = list.filter((a) => a.kind === 'security').sort((a, b) => a.at - b.at);
    const problems = problemsDue ? list.filter((a) => a.kind === 'problem').sort((a, b) => a.at - b.at) : [];
    if (!security.length && !problems.length) continue;
    const admins = (await companyRef.collection('members').where('role', '==', 'admin').get()).docs
      .map((d) => ({ uid: d.id, ...d.data() })).filter((m) => m.status === 'active' && m.email && !m.movedTo);
    for (const a of admins) {
      const prefs = (await db().collection('users').doc(a.uid).get()).data() || {};
      const mine = { security: prefs.emailSecurityAlerts === false ? [] : security, problems: prefs.emailProblemAlerts === false ? [] : problems };
      if (!mine.security.length && !mine.problems.length) continue;
      try {
        await sendEmail(a.email, alertMessage(company.name || 'your company', mine.security, mine.problems, prefs.timeZone || roundup.DEFAULT_TZ));
        console.log(`admin alerts for ${code}: emailed ${a.email}`);
      } catch (err) {
        console.error(`admin alert email to ${a.email} failed:`, err); // not queued as a problem: it would loop
      }
    }
    const batch = db().batch();
    [...security, ...problems].forEach((a) => batch.update(a.ref, { sent: true, sentAt: now }));
    if (problems.length) batch.set(companyRef, { lastProblemEmailAt: now }, { merge: true });
    await batch.commit();
  }
}

exports.adminAlertDigest = onSchedule({ schedule: 'every 15 minutes', secrets: [RESEND_API_KEY] }, sendAdminAlerts);

// Emulator only: run the scheduled jobs on demand from tests.
if (EMULATED) {
  exports.devRunAdminAlerts = onCall(async () => { await sendAdminAlerts(); return { ok: true }; });
}
