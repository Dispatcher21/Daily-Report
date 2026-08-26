// Company-room sync on top of firebase-init.js. A "room" is addressed by
// companies/{code}, where code is a SHA-256 hash of the company password --
// so knowing the password is exactly what lets a device find and read/write
// the room, same trust model as a game lobby code (see the room-code
// discussion this was designed around), just with a password someone
// chooses instead of a generated one. The plaintext password itself is
// never stored anywhere, locally or remotely -- only its hash, which is the
// address, and (for the separate admin password) a hash to compare against.
// See firebase-init.js for why this talks to window.FirebaseCore instead of
// importing the SDK directly (this file is a plain global script, same as
// the rest of the app; only firebase-init.js is an ES module, because the
// Firebase SDK requires it).
//
// Admin is an app-level distinction, not a server-enforced one: any device
// that joined the room (knows the company password) already has full
// Firestore/Storage access under the security rules, same as every member.
// The admin password just unlocks admin-only *actions in this app*
// (replacing the logo, adding projects) -- it stops accidental misuse by
// ordinary crew members, not a deliberate bypass via devtools. Read the
// admin-enforcement discussion in this project's history before changing
// that trade-off; it was a deliberate choice, not an oversight.
//
// Syncs the company logo, and every project/report (photos + signature
// included) under companies/{code}/projects and companies/{code}/reports.
// Reuses the exact merge rule (newer updatedAt wins) already used for the
// local-folder sync and JSON backup import -- see mergeProjectRecord /
// mergeReportRecord in storage.js -- so a pull here behaves identically to
// pulling from a folder or importing a backup, just over the network.

// A push writes the Firestore doc only after its Storage uploads/deletes
// finish, but nothing stops a second, later push for the same report (a
// rapid re-save, or another device) from finishing its own Storage
// operations and doc write in between -- there's no cross-service
// transaction tying "the doc says this photo exists" to "the file is still
// there" when two pushes for the same report race each other. A pull that
// hits exactly that window gets object-not-found for a slot the doc
// (briefly, incorrectly) claims is filled. Rather than let one missing
// file abort an entire join/sync, treat it as "photo unavailable" and keep
// going -- everything else pulled is still valid, and the next push of
// that report will reconcile the doc with what's actually in Storage.
async function getBytesIfExists(storageRef, getBytesFn) {
  try {
    return await getBytesFn(storageRef);
  } catch (err) {
    if (err && err.code === 'storage/object-not-found') {
      console.warn('Storage object missing (likely a sync race), skipping:', storageRef.fullPath);
      return null;
    }
    throw err;
  }
}

const FIRESTORE_SDK = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
const STORAGE_SDK = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
const REPORT_PHOTO_SLOTS = 6;

const COMPANY_CODE_SETTING = 'companyRoomCode';
const COMPANY_NAME_SETTING = 'companyRoomName';
const COMPANY_ADMIN_SETTING = 'companyRoomIsAdmin';
const COMPANY_PERMISSIONS_SETTING = 'companyRoomPermissions';
// Which projects this device may see -- null/absent means unrestricted
// (the normal admin/member case). Set only when this device joined via a
// custom setup's password rather than the company password itself.
const COMPANY_PROJECT_SCOPE_SETTING = 'companyRoomProjectScope';
const COMPANY_ROLE_ID_SETTING = 'companyRoomRoleId';
const LOGO_SYNCED_AT_SETTING = 'companyLogoSyncedAt';

// Both default to admin-only (false) -- a company connected to Firebase for
// the first time should never be more open than the app-level trust model
// requires; an admin opens a permission up deliberately from Company
// Management, not by accident of a missing field on older rooms.
const DEFAULT_PERMISSIONS = {
  membersCanEditOwnReports: false,
  membersCanEditAnyReport: false,
  membersCanEditProjects: false,
  membersCanCreateProjects: false,
};

async function hashText(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Waits for firebase-init.js's module script to finish loading and expose
// window.FirebaseCore, in case this runs before that (both are plain
// <script> tags; module scripts execute after classic ones).
function waitForFirebaseCore() {
  if (window.FirebaseCore) return Promise.resolve(window.FirebaseCore);
  return new Promise((resolve) => {
    window.addEventListener('firebase-core-ready', () => resolve(window.FirebaseCore), { once: true });
  });
}

async function getCompanyRoom() {
  const code = await getSetting(COMPANY_CODE_SETTING);
  if (!code) return null;
  return {
    code,
    name: (await getSetting(COMPANY_NAME_SETTING)) || '',
    isAdmin: !!(await getSetting(COMPANY_ADMIN_SETTING)),
    projectScope: (await getSetting(COMPANY_PROJECT_SCOPE_SETTING)) || null,
  };
}

// True if this device may see `projectId` -- unrestricted (null scope,
// the normal admin/member case) unless a custom setup narrowed it down.
function projectInScope(projectId, room) {
  return !room || !room.projectScope || room.projectScope.includes(projectId);
}

// Creates a brand-new company room, joins it locally as admin (whoever sets
// the admin password is trivially the first admin), and pushes everything
// already on this device -- logo, projects, and reports -- so a room
// created from a device with existing data starts other devices off with
// it, exactly like the first connection to a Local Save Folder does.
async function createCompanyRoom({ name, password, adminPassword }, onProgress) {
  if (!password) throw new Error('Choose a company password.');
  if (!adminPassword) throw new Error('Choose an admin password.');

  const { db, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, setDoc, serverTimestamp } = await import(FIRESTORE_SDK);
  await ensureSignedIn();

  const code = await hashText(password);
  await setDoc(doc(db, 'companies', code), {
    name: name || '',
    adminPasswordHash: await hashText(adminPassword),
    permissions: DEFAULT_PERMISSIONS,
    createdAt: serverTimestamp(),
  });

  await saveSetting(COMPANY_CODE_SETTING, code);
  await saveSetting(COMPANY_NAME_SETTING, name || '');
  await saveSetting(COMPANY_ADMIN_SETTING, true);
  await saveSetting(COMPANY_PERMISSIONS_SETTING, DEFAULT_PERMISSIONS);

  if (await getReportLogo()) {
    if (onProgress) onProgress({ phase: 'logo' });
    await pushCompanyLogo();
  }
  await pushAllLocalData(code, onProgress);

  return { code, name: name || '' };
}

// Joins an existing room by password -- fails if no room matches rather
// than silently creating one, so a typo doesn't quietly start an orphan
// room. Joins as a regular member; see unlockCompanyAdmin for the admin
// password. Pulls in everything the room already has (merge only, same
// rule as a JSON backup import -- never deletes anything already on this
// device).
//
// A custom setup's password (see createCustomRole) resolves the exact
// same way as the company password -- hash it, look up companies/{hash} --
// except what's found there is a small pointer doc rather than the company
// itself: { isRoleSetup: true, companyCode, permissions, projectIds }. This
// device then joins that *real* company but adopts the setup's permissions
// and project scope instead of the plain-member defaults. One password,
// one field, one flow either way -- the difference is invisible to the
// person typing it in.
async function joinCompanyRoom(password, onProgress) {
  if (!password) throw new Error('Enter the company password.');

  if (onProgress) onProgress({ phase: 'signing-in' });
  const { db, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, getDoc } = await import(FIRESTORE_SDK);
  await ensureSignedIn();

  if (onProgress) onProgress({ phase: 'looking-up' });
  const enteredHash = await hashText(password);
  const snap = await getDoc(doc(db, 'companies', enteredHash));
  if (!snap.exists()) throw new Error('No company found with that password.');
  const data = snap.data();

  let code = enteredHash;
  let companyDoc = data;
  let roleId = null;
  let scopedPermissions = null;
  let projectIds = null;

  if (data.isRoleSetup) {
    code = data.companyCode;
    roleId = data.roleId;
    scopedPermissions = data.permissions || {};
    projectIds = data.projectIds || [];
    const realSnap = await getDoc(doc(db, 'companies', code));
    if (!realSnap.exists()) throw new Error('This setup points to a company that no longer exists.');
    companyDoc = realSnap.data();
  }

  await saveSetting(COMPANY_CODE_SETTING, code);
  await saveSetting(COMPANY_NAME_SETTING, companyDoc.name || '');
  await saveSetting(COMPANY_ADMIN_SETTING, false);
  await saveSetting(COMPANY_ROLE_ID_SETTING, roleId);
  await saveSetting(COMPANY_PROJECT_SCOPE_SETTING, projectIds);
  await saveSetting(
    COMPANY_PERMISSIONS_SETTING,
    scopedPermissions ? { ...DEFAULT_PERMISSIONS, ...scopedPermissions } : { ...DEFAULT_PERMISSIONS, ...(companyDoc.permissions || {}) }
  );
  await saveSetting(LOGO_SYNCED_AT_SETTING, null);

  const pulled = await pullAllCompanyData(code, onProgress);
  // Logo + project background photos are fetched eagerly (not deferred
  // until something's actually opened, unlike report photos), but not
  // awaited here -- they can be large, and nobody should have to wait on a
  // photo just to finish logging in. They land locally moments later; see
  // pullCompanyMediaInBackground.
  pullCompanyMediaInBackground(code);
  return { code, name: companyDoc.name || '', ...pulled };
}

// Elevates this device to admin within the room it's already joined, if the
// given password matches the room's admin password hash.
async function unlockCompanyAdmin(adminPassword) {
  const room = await getCompanyRoom();
  if (!room) throw new Error('Not connected to a company.');
  if (!adminPassword) throw new Error('Enter the admin password.');

  const { db, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, getDoc } = await import(FIRESTORE_SDK);
  await ensureSignedIn();

  const snap = await getDoc(doc(db, 'companies', room.code));
  const expected = snap.exists() ? snap.data().adminPasswordHash : null;
  if (!expected || (await hashText(adminPassword)) !== expected) {
    throw new Error('Incorrect admin password.');
  }
  await saveSetting(COMPANY_ADMIN_SETTING, true);
  // Admin overrides any custom setup's project scope this device might
  // have joined under -- full access, not a narrower view layered on top.
  await saveSetting(COMPANY_PROJECT_SCOPE_SETTING, null);
  await saveSetting(COMPANY_ROLE_ID_SETTING, null);
}

// Leaves the room on this device only -- the room and its data on the
// server are completely untouched, exactly like "Forget This Folder" for
// the local-folder sync (rejoining pulls everything straight back down).
// Locally, though, this device keeps only reports it actually created or
// edited (and whichever projects those belong to) -- everything else this
// device only ever synced passively is pruned, so a departing member
// doesn't walk away with a full copy of the company's data still sitting
// on their phone.
async function leaveCompanyRoom() {
  const userName = await getUserName();

  let reportIdsToDelete = [];
  let projectIdsToDelete = [];
  if (userName) {
    const reports = await getAllReports();
    const touchedProjectIds = new Set();
    for (const r of reports) {
      if (r.createdBy === userName || r.lastEditedBy === userName) touchedProjectIds.add(r.projectId);
      else reportIdsToDelete.push(r.id);
    }
    const projects = await getAllProjects();
    projectIdsToDelete = projects.filter((p) => !touchedProjectIds.has(p.id)).map((p) => p.id);
  }

  // Cleared before the pruning below runs, not after: deleteReport/
  // deleteProject's live hooks push a deletion to the company, gated on
  // getCompanyRoom() returning a room -- clearing first makes that a no-op,
  // so this only ever prunes this device's local copy and never touches
  // anyone else's data.
  await deleteSetting(COMPANY_CODE_SETTING);
  await deleteSetting(COMPANY_NAME_SETTING);
  await deleteSetting(COMPANY_ADMIN_SETTING);
  await deleteSetting(COMPANY_PERMISSIONS_SETTING);
  await deleteSetting(COMPANY_PROJECT_SCOPE_SETTING);
  await deleteSetting(COMPANY_ROLE_ID_SETTING);
  await deleteSetting(LOGO_SYNCED_AT_SETTING);

  for (const id of reportIdsToDelete) await deleteReport(id);
  for (const id of projectIdsToDelete) await deleteProject(id); // also removes any of its remaining reports (none this device touched, by construction)
}

// Pulls in anything new from the room, then pushes every local project and
// report back out -- pull first, same ordering as the local-folder sync,
// so a stale local copy can't clobber something newer that's already in
// the room. Also refreshes the cached company name/permissions (or, for a
// device that joined via a custom setup, that setup's own permissions and
// project scope), in case an admin changed them from a different device.
async function syncCompanyRoomNow(onProgress) {
  const room = await getCompanyRoom();
  if (!room) throw new Error('Not connected to a company room.');

  const { db, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, getDoc } = await import(FIRESTORE_SDK);
  await ensureSignedIn();
  const snap = await getDoc(doc(db, 'companies', room.code));
  if (snap.exists()) {
    const data = snap.data();
    await saveSetting(COMPANY_NAME_SETTING, data.name || '');
    if (!room.isAdmin) {
      const roleId = await getSetting(COMPANY_ROLE_ID_SETTING);
      if (roleId) {
        const roleSnap = await getDoc(doc(db, 'companies', room.code, 'roles', roleId));
        if (roleSnap.exists()) {
          const role = roleSnap.data();
          await saveSetting(COMPANY_PERMISSIONS_SETTING, { ...DEFAULT_PERMISSIONS, ...(role.permissions || {}) });
          await saveSetting(COMPANY_PROJECT_SCOPE_SETTING, role.projectIds || []);
        }
      } else {
        await saveSetting(COMPANY_PERMISSIONS_SETTING, { ...DEFAULT_PERMISSIONS, ...(data.permissions || {}) });
      }
    }
  }

  const pulled = await pullAllCompanyData(room.code, onProgress);
  pullCompanyMediaInBackground(room.code); // see joinCompanyRoom -- not awaited on purpose
  await pushAllLocalData(room.code, onProgress);
  return pulled;
}

// ---------- Company Management -- admin-only actions ----------

async function getCompanyPermissions() {
  return { ...DEFAULT_PERMISSIONS, ...((await getSetting(COMPANY_PERMISSIONS_SETTING)) || {}) };
}

// True if this device may perform `action` in its current company context.
// Outside a company there's nothing to protect, so everything is allowed --
// gating only ever applies once a shared company is actually connected.
// Report editing isn't covered here -- it depends on which report (see
// getReportPermissionContext / canEditReportWithContext below), not just a
// flat yes/no.
async function companyCan(action) {
  const room = await getCompanyRoom();
  if (!room || room.isAdmin) return true;
  const perms = await getCompanyPermissions();
  if (action === 'createProjects') return !!perms.membersCanCreateProjects;
  return !!perms.membersCanEditProjects; // 'editProjects'
}

// Report edit/delete permission depends on *which* report -- "own" only
// grants it for reports this device's logged-in name created. Fetch this
// once per page (room/permissions/name each cost a settings read) and
// reuse it across every row with the synchronous check below, rather than
// re-fetching per report.
async function getReportPermissionContext() {
  const room = await getCompanyRoom();
  const userName = await getUserName();
  if (!room || room.isAdmin) return { isAdmin: true, canEditAny: true, canEditOwn: true, userName };
  const perms = await getCompanyPermissions();
  return {
    isAdmin: false,
    canEditAny: !!perms.membersCanEditAnyReport,
    canEditOwn: !!perms.membersCanEditOwnReports,
    userName,
  };
}

function canEditReportWithContext(report, ctx) {
  if (ctx.isAdmin || ctx.canEditAny) return true;
  if (ctx.canEditOwn) return !!ctx.userName && report.createdBy === ctx.userName;
  return false;
}

async function updateCompanyPermissions(patch) {
  const room = await getCompanyRoom();
  if (!room) throw new Error('Not connected to a company.');
  if (!room.isAdmin) throw new Error('Only an admin can change permissions.');

  const { db, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, updateDoc } = await import(FIRESTORE_SDK);
  await ensureSignedIn();

  const merged = { ...(await getCompanyPermissions()), ...patch };
  await updateDoc(doc(db, 'companies', room.code), { permissions: merged });
  await saveSetting(COMPANY_PERMISSIONS_SETTING, merged);
  return merged;
}

async function updateCompanyName(name) {
  const room = await getCompanyRoom();
  if (!room) throw new Error('Not connected to a company.');
  if (!room.isAdmin) throw new Error('Only an admin can rename the company.');

  const { db, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, updateDoc } = await import(FIRESTORE_SDK);
  await ensureSignedIn();

  await updateDoc(doc(db, 'companies', room.code), { name: name || '' });
  await saveSetting(COMPANY_NAME_SETTING, name || '');
}

// Rotates the *company* password -- unlike the admin password, this isn't
// a single field: the room's address (companies/{code}) is derived from
// hash(password), so this pulls in the latest data first (so nothing this
// device hasn't seen yet gets left behind), creates a new room at
// hash(newPassword) with the same name/permissions/admin password, and
// pushes every local project and report into it -- reusing pushAllLocalData
// exactly as Create Company and Sync Now do, since this device's IndexedDB
// already holds the full picture once the pull above completes.
//
// The old room is deliberately left in place rather than deleted: deleting
// it would turn a stale device's next autosave into a silent write to a
// company that no longer exists to anyone, which is worse than a harmless
// orphaned room sitting unused in Firestore. There is no way to push the
// new password to other devices automatically -- the caller is responsible
// for telling every other device to Leave and rejoin with it.
async function changeCompanyPassword(newPassword, onProgress) {
  const room = await getCompanyRoom();
  if (!room) throw new Error('Not connected to a company.');
  if (!room.isAdmin) throw new Error('Only an admin can change the company password.');
  if (!newPassword) throw new Error('Enter a new company password.');

  const { db, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, getDoc, setDoc, serverTimestamp } = await import(FIRESTORE_SDK);
  await ensureSignedIn();

  if (onProgress) onProgress({ phase: 'pulling' });
  await pullAllCompanyData(room.code, onProgress);
  // Unlike Join/Sync Now, this waits for the logo and every project
  // background too -- migrating to a new address wants the fullest
  // possible local picture before copying it, not a fast return.
  await pullAllCompanyMediaBlocking(room.code);

  const oldSnap = await getDoc(doc(db, 'companies', room.code));
  const oldData = oldSnap.exists() ? oldSnap.data() : {};

  const newCode = await hashText(newPassword);
  if (onProgress) onProgress({ phase: 'creating' });
  await setDoc(doc(db, 'companies', newCode), {
    name: oldData.name || '',
    adminPasswordHash: oldData.adminPasswordHash,
    permissions: oldData.permissions || DEFAULT_PERMISSIONS,
    createdAt: serverTimestamp(),
  });

  await saveSetting(COMPANY_CODE_SETTING, newCode);
  await saveSetting(LOGO_SYNCED_AT_SETTING, null); // force a fresh logo push under the new address

  if (await getReportLogo()) {
    if (onProgress) onProgress({ phase: 'logo' });
    await pushCompanyLogo();
  }
  await pushAllLocalData(newCode, onProgress);

  return { oldCode: room.code, newCode };
}

async function changeCompanyAdminPassword(newAdminPassword) {
  const room = await getCompanyRoom();
  if (!room) throw new Error('Not connected to a company.');
  if (!room.isAdmin) throw new Error('Only an admin can change the admin password.');
  if (!newAdminPassword) throw new Error('Enter a new admin password.');

  const { db, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, updateDoc } = await import(FIRESTORE_SDK);
  await ensureSignedIn();

  await updateDoc(doc(db, 'companies', room.code), { adminPasswordHash: await hashText(newAdminPassword) });
}

// ---------- Custom setups ----------
//
// A "custom setup" is a named, project-scoped variant of the plain member
// permissions -- e.g. an inspector who should only ever see one project.
// It's addressed exactly like the company/admin passwords (hash of its own
// password), but what lives at that address is a small pointer doc rather
// than a company: { isRoleSetup, companyCode, roleId, permissions,
// projectIds } -- see joinCompanyRoom for how a device resolves through it.
// The companies/{code}/roles/{roleId} doc alongside it is what lets
// Company Management list/edit/delete setups without knowing their
// passwords (which, like every other password in this app, are never
// stored -- only their hash).

async function listCustomRoles() {
  const room = await getCompanyRoom();
  if (!room) return [];
  const { db, ensureSignedIn } = await waitForFirebaseCore();
  const { collection, getDocs } = await import(FIRESTORE_SDK);
  await ensureSignedIn();
  const snap = await getDocs(collection(db, 'companies', room.code, 'roles'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Returns the password so the caller can show it once -- there is no way
// to retrieve it again after this, same as the company/admin passwords.
async function createCustomRole({ name, password, permissions, projectIds }) {
  const room = await getCompanyRoom();
  if (!room) throw new Error('Not connected to a company.');
  if (!room.isAdmin) throw new Error('Only an admin can create a custom setup.');
  if (!name) throw new Error('Name this setup.');
  if (!password) throw new Error('Choose a password for this setup.');

  const { db, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, getDoc, setDoc } = await import(FIRESTORE_SDK);
  await ensureSignedIn();

  const pointerCode = await hashText(password);
  if (pointerCode === room.code) throw new Error('Choose a password different from the company password.');
  const existing = await getDoc(doc(db, 'companies', pointerCode));
  if (existing.exists()) throw new Error('That password is already in use (by this company or another) -- choose a different one.');

  const roleId = crypto.randomUUID();
  const mergedPermissions = { ...DEFAULT_PERMISSIONS, ...permissions };
  const finalProjectIds = projectIds || [];

  await setDoc(doc(db, 'companies', room.code, 'roles', roleId), {
    name,
    permissions: mergedPermissions,
    projectIds: finalProjectIds,
    pointerCode,
    createdAt: Date.now(),
  });
  await setDoc(doc(db, 'companies', pointerCode), {
    isRoleSetup: true,
    companyCode: room.code,
    roleId,
    name,
    permissions: mergedPermissions,
    projectIds: finalProjectIds,
  });

  return { id: roleId, password };
}

async function deleteCustomRole(roleId) {
  const room = await getCompanyRoom();
  if (!room) throw new Error('Not connected to a company.');
  if (!room.isAdmin) throw new Error('Only an admin can delete a custom setup.');

  const { db, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, getDoc, deleteDoc } = await import(FIRESTORE_SDK);
  await ensureSignedIn();

  const roleSnap = await getDoc(doc(db, 'companies', room.code, 'roles', roleId));
  if (roleSnap.exists()) {
    await deleteDoc(doc(db, 'companies', roleSnap.data().pointerCode)).catch(() => {});
  }
  await deleteDoc(doc(db, 'companies', room.code, 'roles', roleId));
}

// ---------- Logo sync ----------
//
// The logo is small and changes rarely, so it's synced explicitly (on
// join, and whenever it's uploaded in Settings) rather than watched
// continuously -- see the "download once" discussion this was designed
// around. logoUpdatedAt on the Firestore doc lets a pull skip the Storage
// download entirely when the local copy is already current.

async function pushCompanyLogo() {
  const room = await getCompanyRoom();
  if (!room) return;
  const logo = await getReportLogo();
  if (!logo) return;

  const { db, storage, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, updateDoc, serverTimestamp } = await import(FIRESTORE_SDK);
  const { ref, uploadBytes } = await import(STORAGE_SDK);
  await ensureSignedIn();

  await uploadBytes(ref(storage, `companies/${room.code}/logo`), logo, { contentType: logo.type });
  await updateDoc(doc(db, 'companies', room.code), { logoUpdatedAt: serverTimestamp() });
  await saveSetting(LOGO_SYNCED_AT_SETTING, Date.now());
}

// Pulls the room's logo down and adopts it locally, but only if the room's
// copy is actually newer than what this device last synced -- skips the
// Storage download otherwise (see file header).
async function pullCompanyLogo() {
  const room = await getCompanyRoom();
  if (!room) return false;

  const { db, storage, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, getDoc } = await import(FIRESTORE_SDK);
  const { ref, getBytes, getMetadata } = await import(STORAGE_SDK);
  await ensureSignedIn();

  const snap = await getDoc(doc(db, 'companies', room.code));
  const remoteUpdatedAt = snap.exists() && snap.data().logoUpdatedAt ? snap.data().logoUpdatedAt.toMillis() : 0;
  if (!remoteUpdatedAt) return false; // room has no logo yet

  const localSyncedAt = (await getSetting(LOGO_SYNCED_AT_SETTING)) || 0;
  if (remoteUpdatedAt <= localSyncedAt) return false; // already current

  const logoRef = ref(storage, `companies/${room.code}/logo`);
  const [bytes, metadata] = await Promise.all([getBytesIfExists(logoRef, getBytes), getMetadata(logoRef).catch(() => null)]);
  if (!bytes) return false; // logoUpdatedAt says there should be one, but the file's briefly missing (see getBytesIfExists) -- try again next sync
  const blob = new Blob([bytes], { type: (metadata && metadata.contentType) || 'image/png' });

  await saveReportLogo(blob);
  await saveSetting(LOGO_SYNCED_AT_SETTING, Date.now());
  return true;
}

// Downloads the logo and every project's background image, waiting for
// all of it. Only changeCompanyPassword uses this -- migrating to a new
// room address wants the fullest possible local picture before copying
// everything over, unlike Join/Sync Now which want to return fast (see
// pullCompanyMediaInBackground below).
async function pullAllCompanyMediaBlocking(code) {
  await pullCompanyLogo();
  const projects = await getAllProjects();
  for (const project of projects) {
    if (project.backgroundImageFetched === false) {
      await putProjectRaw(await fetchProjectBackground(code, project));
    }
  }
}

// Downloads the logo and every project's background image too, but fires
// without awaiting -- Join and Sync Now return as soon as the small,
// text-only project/report data has synced, rather than making someone
// wait on what could be a large photo just to finish logging in. Each
// piece updates local storage the moment it lands and fires
// 'company-media-updated' so any open page (index.html's project cards,
// the header logo, project.html's page background) can refresh itself
// without the user having to reload.
function pullCompanyMediaInBackground(code) {
  pullCompanyLogo()
    .then((changed) => {
      if (changed) window.dispatchEvent(new CustomEvent('company-media-updated'));
    })
    .catch((err) => console.error('background logo pull:', err));

  getAllProjects().then((projects) => {
    projects
      .filter((p) => p.backgroundImageFetched === false)
      .forEach((project) => {
        fetchProjectBackground(code, project)
          .then((updated) => putProjectRaw(updated))
          .then(() => window.dispatchEvent(new CustomEvent('company-media-updated')))
          .catch((err) => console.error('background image pull:', err));
      });
  });
}

// ---------- Project sync ----------
//
// Projects carry no blob fields (see storage.js -- the old templateBlob was
// retired), so a project doc is just the record itself, stripped of
// anything Firestore can't store (undefined values, functions) via the
// JSON round-trip below.

function projectBackgroundPath(code, projectId) {
  return `companies/${code}/projects/${projectId}/background`;
}

async function pushProjectToCompany(code, project) {
  const { db, storage, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, getDoc, setDoc } = await import(FIRESTORE_SDK);
  const { ref, uploadBytes, deleteObject } = await import(STORAGE_SDK);
  await ensureSignedIn();

  // Same story as report photos: a device that pulled this project before
  // its background image finished downloading in the background (see
  // pullCompanyMediaInBackground) must never write hasBackgroundImage as
  // if that meant "no background" -- it just means "unknown here yet".
  // Preserve whatever the doc currently says for that case instead.
  const bgFetched = project.backgroundImageFetched !== false;
  let hasBackgroundImage;
  if (bgFetched) {
    const bgRef = ref(storage, projectBackgroundPath(code, project.id));
    if (project.backgroundImage) {
      await uploadBytes(bgRef, project.backgroundImage, { contentType: project.backgroundImage.type || 'image/jpeg' });
    } else {
      await deleteObject(bgRef).catch(() => {});
    }
    hasBackgroundImage = !!project.backgroundImage;
  } else {
    const existingDoc = await getDoc(doc(db, 'companies', code, 'projects', project.id));
    hasBackgroundImage = existingDoc.exists() ? !!existingDoc.data().hasBackgroundImage : false;
  }

  const { backgroundImage: _bg, backgroundImageFetched: _bgf, ...rest } = project;
  const data = JSON.parse(JSON.stringify(rest));
  data.hasBackgroundImage = hasBackgroundImage;
  await setDoc(doc(db, 'companies', code, 'projects', project.id), data);
}

// Downloads a project's background image if it hasn't been fetched by this
// device yet -- used by pullCompanyMediaInBackground, not called inline
// during the main project pull so a slow/large photo can never delay
// finishing a join. A no-op if already local or the project has none.
async function fetchProjectBackground(code, project) {
  if (project.backgroundImageFetched !== false) return project;
  const { storage, ensureSignedIn } = await waitForFirebaseCore();
  const { ref, getBytes } = await import(STORAGE_SDK);
  await ensureSignedIn();
  const bytes = await getBytesIfExists(ref(storage, projectBackgroundPath(code, project.id)), getBytes);
  return { ...project, backgroundImage: bytes ? new Blob([bytes], { type: 'image/jpeg' }) : null, backgroundImageFetched: true };
}

async function deleteProjectFromCompany(code, project) {
  const { db, storage, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, deleteDoc } = await import(FIRESTORE_SDK);
  const { ref, deleteObject } = await import(STORAGE_SDK);
  await ensureSignedIn();
  await deleteObject(ref(storage, projectBackgroundPath(code, project.id))).catch(() => {});
  await deleteDoc(doc(db, 'companies', code, 'projects', project.id));
}

// ---------- Report sync ----------
//
// A report's photos/signature are the only blob fields -- they go to
// Storage at deterministic per-report paths (companies/{code}/reports/{id}/
// photo-N, .../signature), while the Firestore doc carries every other
// field plus which of those slots are actually filled (photoSlots,
// hasSignature), since slot position is meaningful and a doc can't hold
// Storage refs directly.

function reportPhotoPath(code, reportId, i) {
  return `companies/${code}/reports/${reportId}/photo-${i}`;
}
function reportSignaturePath(code, reportId) {
  return `companies/${code}/reports/${reportId}/signature`;
}

async function pushReportToCompany(code, report) {
  const { db, storage, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, getDoc, setDoc } = await import(FIRESTORE_SDK);
  const { ref, uploadBytes, deleteObject } = await import(STORAGE_SDK);
  await ensureSignedIn();

  // A slot this device never fetched (photosFetched[i] false -- see
  // fetchReportMedia) is a total unknown locally: it must be left alone,
  // not touched in Storage and not overwritten in the doc, or a device
  // that only opened some of a report's photos would silently delete the
  // rest of them just by saving an unrelated field. Reading the current
  // doc first is what makes "leave it alone" possible, since the write
  // below is otherwise a full overwrite of photoSlots/hasSignature.
  const existingDoc = await getDoc(doc(db, 'companies', code, 'reports', report.id));
  const existingData = existingDoc.exists() ? existingDoc.data() : {};
  const existingPhotoSlots = existingData.photoSlots || [];

  const photos = report.photos || [];
  const photosFetched = report.photosFetched || photos.map(() => true);
  const signatureFetched = report.signatureFetched !== false;

  // All touched slots upload/delete in parallel rather than one at a time
  // -- a report with 6 photos + a signature was 7 sequential round trips
  // before, which is where "Create Company" felt like it hung on a device
  // with any real amount of local data.
  const photoUploads = photos.map((photo, i) => {
    if (!photosFetched[i]) return Promise.resolve(); // unknown locally -- don't touch it
    const photoRef = ref(storage, reportPhotoPath(code, report.id, i));
    return photo
      ? uploadBytes(photoRef, photo, { contentType: photo.type || 'image/jpeg' })
      : deleteObject(photoRef).catch(() => {}); // wasn't there -- nothing to remove
  });

  const sigRef = ref(storage, reportSignaturePath(code, report.id));
  const sigUpload = !signatureFetched
    ? Promise.resolve()
    : report.repSignatureImage
      ? uploadBytes(sigRef, report.repSignatureImage, { contentType: report.repSignatureImage.type || 'image/png' })
      : deleteObject(sigRef).catch(() => {});

  await Promise.all([...photoUploads, sigUpload]);

  const { photos: _photos, photosFetched: _pf, repSignatureImage: _sig, signatureFetched: _sf, peSignatureImage: _peSig, ...rest } = report;
  const data = JSON.parse(JSON.stringify(rest));
  data.photoSlots = photos.map((p, i) => (photosFetched[i] ? !!p : !!existingPhotoSlots[i]));
  data.hasSignature = signatureFetched ? !!report.repSignatureImage : !!existingData.hasSignature;
  await setDoc(doc(db, 'companies', code, 'reports', report.id), data);
}

async function deleteReportFromCompany(code, report) {
  const { db, storage, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, deleteDoc } = await import(FIRESTORE_SDK);
  const { ref, deleteObject } = await import(STORAGE_SDK);
  await ensureSignedIn();

  for (let i = 0; i < REPORT_PHOTO_SLOTS; i++) {
    await deleteObject(ref(storage, reportPhotoPath(code, report.id, i))).catch(() => {});
  }
  await deleteObject(ref(storage, reportSignaturePath(code, report.id))).catch(() => {});
  await deleteDoc(doc(db, 'companies', code, 'reports', report.id));
}

// ---------- Bulk pull / push -- used by join and "Sync Now" ----------

async function pullAllCompanyData(code, onProgress) {
  const { db, storage, ensureSignedIn } = await waitForFirebaseCore();
  const { collection, getDocs } = await import(FIRESTORE_SDK);
  const { ref, getBytes } = await import(STORAGE_SDK);
  await ensureSignedIn();

  const summary = { projectsPulled: 0, reportsPulled: 0 };

  // Project metadata (name, pay items, everything except the background
  // photo) stays eager -- small text, needed immediately. The background
  // photo itself is deferred to pullCompanyMediaInBackground so a large
  // image can never delay a join/sync finishing; a slot already fetched by
  // this device previously is carried forward rather than re-marked
  // unfetched, same reasoning as report photos.
  if (onProgress) onProgress({ phase: 'projects' });
  const projectsSnap = await getDocs(collection(db, 'companies', code, 'projects'));
  for (const d of projectsSnap.docs) {
    const data = d.data();
    const project = { ...data, id: d.id };
    delete project.hasBackgroundImage;

    const existing = await getProject(d.id);
    const alreadyFetched = existing && existing.backgroundImageFetched && existing.backgroundImage;
    if (!data.hasBackgroundImage) {
      project.backgroundImage = null;
      project.backgroundImageFetched = true;
    } else if (alreadyFetched) {
      project.backgroundImage = existing.backgroundImage;
      project.backgroundImageFetched = true;
    } else {
      project.backgroundImage = null;
      project.backgroundImageFetched = false;
    }

    const result = await mergeProjectRecord(project);
    if (result !== 'skipped') summary.projectsPulled++;
  }

  // Report data (dates, quantities, notes -- everything except photo/
  // signature bytes) stays eager: it's small text, and the dashboard and
  // Quantity Sheet need it available offline right away. Photos are the
  // heavy part and the thing actually worth deferring -- see
  // fetchReportMedia, called on demand by report-editor.html and
  // download.html. A slot already downloaded by this device previously
  // (photosFetched[i] true with a real Blob) is carried forward here
  // rather than re-marked as unfetched, so a report doesn't "forget" its
  // already-local photos just because some other field changed elsewhere
  // and triggered a re-pull.
  const reportsSnap = await getDocs(collection(db, 'companies', code, 'reports'));
  const reportDocs = reportsSnap.docs;
  for (let i = 0; i < reportDocs.length; i++) {
    const d = reportDocs[i];
    if (onProgress) onProgress({ phase: 'reports', index: i + 1, total: reportDocs.length });

    const data = d.data();
    const report = { ...data, id: d.id };
    delete report.photoSlots;
    delete report.hasSignature;

    const existing = await getReport(d.id);

    report.photos = [];
    report.photosFetched = [];
    for (let slot = 0; slot < REPORT_PHOTO_SLOTS; slot++) {
      const remoteHasPhoto = !!(data.photoSlots && data.photoSlots[slot]);
      const alreadyFetched = existing && existing.photosFetched && existing.photosFetched[slot] && existing.photos && existing.photos[slot];
      if (!remoteHasPhoto) {
        report.photos.push(null);
        report.photosFetched.push(true); // confirmed empty, nothing to fetch
      } else if (alreadyFetched) {
        report.photos.push(existing.photos[slot]); // already have it locally -- don't refetch
        report.photosFetched.push(true);
      } else {
        report.photos.push(null);
        report.photosFetched.push(false); // present remotely, not yet downloaded
      }
    }

    const remoteHasSignature = !!data.hasSignature;
    const signatureAlreadyFetched = existing && existing.signatureFetched && existing.repSignatureImage;
    if (!remoteHasSignature) {
      report.repSignatureImage = null;
      report.signatureFetched = true;
    } else if (signatureAlreadyFetched) {
      report.repSignatureImage = existing.repSignatureImage;
      report.signatureFetched = true;
    } else {
      report.repSignatureImage = null;
      report.signatureFetched = false;
    }

    const result = await mergeReportRecord(report);
    if (result !== 'skipped') summary.reportsPulled++;
  }

  return summary;
}

// Downloads whichever photo/signature slots of `report` haven't been
// fetched yet (photosFetched[i]/signatureFetched false, left that way by
// the lazy pull above), returning an updated copy -- doesn't save it, the
// caller decides when (report-editor.html on open, download.html before
// generating a PDF). A no-op, no network calls, once everything's already
// local.
async function fetchReportMedia(report) {
  const room = await getCompanyRoom();
  if (!room) return report;

  const needsPhotos = (report.photosFetched || []).some((f) => !f);
  const needsSignature = report.signatureFetched === false;
  if (!needsPhotos && !needsSignature) return report;

  const { storage, ensureSignedIn } = await waitForFirebaseCore();
  const { ref, getBytes } = await import(STORAGE_SDK);
  await ensureSignedIn();

  const updated = { ...report, photos: [...report.photos], photosFetched: [...(report.photosFetched || [])] };
  await Promise.all(
    updated.photos.map(async (_, slot) => {
      if (updated.photosFetched[slot]) return;
      const bytes = await getBytesIfExists(ref(storage, reportPhotoPath(room.code, report.id, slot)), getBytes);
      updated.photos[slot] = bytes ? new Blob([bytes], { type: 'image/jpeg' }) : null;
      updated.photosFetched[slot] = true;
    })
  );

  if (needsSignature) {
    const bytes = await getBytesIfExists(ref(storage, reportSignaturePath(room.code, report.id)), getBytes);
    updated.repSignatureImage = bytes ? new Blob([bytes], { type: 'image/png' }) : null;
    updated.signatureFetched = true;
  }

  return updated;
}

async function pushAllLocalData(code, onProgress) {
  const projects = await getAllProjects();
  await Promise.all(projects.map((project) => pushProjectToCompany(code, project)));
  if (onProgress) onProgress({ phase: 'projects', count: projects.length });

  const reports = await getAllReports();
  for (let i = 0; i < reports.length; i++) {
    await pushReportToCompany(code, reports[i]);
    if (onProgress) onProgress({ phase: 'reports', index: i + 1, total: reports.length });
  }
}

// ---------- live hooks -- called from storage.js after every save/delete ----------
//
// Always pushes immediately, unlike the local-folder sync's optional
// auto-sync toggle -- the point of a shared room is that the team stays in
// sync without a manual step, so there's no "off" setting here.

async function onCompanySyncProjectChanged(project, deleted) {
  const room = await getCompanyRoom();
  if (!room) return;
  if (deleted) await deleteProjectFromCompany(room.code, project);
  else await pushProjectToCompany(room.code, project);
}

async function onCompanySyncReportChanged(report, deleted) {
  const room = await getCompanyRoom();
  if (!room) return;
  if (deleted) await deleteReportFromCompany(room.code, report);
  else await pushReportToCompany(room.code, report);
}
