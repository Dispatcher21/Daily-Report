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

const FIRESTORE_SDK = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
const STORAGE_SDK = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
const REPORT_PHOTO_SLOTS = 6;

const COMPANY_CODE_SETTING = 'companyRoomCode';
const COMPANY_NAME_SETTING = 'companyRoomName';
const COMPANY_ADMIN_SETTING = 'companyRoomIsAdmin';
const LOGO_SYNCED_AT_SETTING = 'companyLogoSyncedAt';

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
  };
}

// Creates a brand-new company room, joins it locally as admin (whoever sets
// the admin password is trivially the first admin), and pushes everything
// already on this device -- logo, projects, and reports -- so a room
// created from a device with existing data starts other devices off with
// it, exactly like the first connection to a Local Save Folder does.
async function createCompanyRoom({ name, password, adminPassword }) {
  if (!password) throw new Error('Choose a company password.');
  if (!adminPassword) throw new Error('Choose an admin password.');

  const { db, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, setDoc, serverTimestamp } = await import(FIRESTORE_SDK);
  await ensureSignedIn();

  const code = await hashText(password);
  await setDoc(doc(db, 'companies', code), {
    name: name || '',
    adminPasswordHash: await hashText(adminPassword),
    createdAt: serverTimestamp(),
  });

  await saveSetting(COMPANY_CODE_SETTING, code);
  await saveSetting(COMPANY_NAME_SETTING, name || '');
  await saveSetting(COMPANY_ADMIN_SETTING, true);

  if (await getReportLogo()) await pushCompanyLogo();
  await pushAllLocalData(code);

  return { code, name: name || '' };
}

// Joins an existing room by password -- fails if no room matches rather
// than silently creating one, so a typo doesn't quietly start an orphan
// room. Joins as a regular member; see unlockCompanyAdmin for the admin
// password. Pulls in everything the room already has (merge only, same
// rule as a JSON backup import -- never deletes anything already on this
// device).
async function joinCompanyRoom(password) {
  if (!password) throw new Error('Enter the company password.');

  const { db, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, getDoc } = await import(FIRESTORE_SDK);
  await ensureSignedIn();

  const code = await hashText(password);
  const snap = await getDoc(doc(db, 'companies', code));
  if (!snap.exists()) throw new Error('No company found with that password.');

  const data = snap.data();
  await saveSetting(COMPANY_CODE_SETTING, code);
  await saveSetting(COMPANY_NAME_SETTING, data.name || '');
  await saveSetting(COMPANY_ADMIN_SETTING, false);
  await saveSetting(LOGO_SYNCED_AT_SETTING, null);

  await pullCompanyLogo();
  const pulled = await pullAllCompanyData(code);
  return { code, name: data.name || '', ...pulled };
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
}

// Leaves the room on this device only -- the room itself and its data are
// untouched, exactly like "Forget This Folder" for the local-folder sync.
async function leaveCompanyRoom() {
  await deleteSetting(COMPANY_CODE_SETTING);
  await deleteSetting(COMPANY_NAME_SETTING);
  await deleteSetting(COMPANY_ADMIN_SETTING);
  await deleteSetting(LOGO_SYNCED_AT_SETTING);
}

// Pulls in anything new from the room, then pushes every local project and
// report back out -- pull first, same ordering as the local-folder sync,
// so a stale local copy can't clobber something newer that's already in
// the room.
async function syncCompanyRoomNow() {
  const room = await getCompanyRoom();
  if (!room) throw new Error('Not connected to a company room.');
  await pullCompanyLogo();
  const pulled = await pullAllCompanyData(room.code);
  await pushAllLocalData(room.code);
  return pulled;
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
  const [bytes, metadata] = await Promise.all([getBytes(logoRef), getMetadata(logoRef)]);
  const blob = new Blob([bytes], { type: metadata.contentType || 'image/png' });

  await saveReportLogo(blob);
  await saveSetting(LOGO_SYNCED_AT_SETTING, Date.now());
  return true;
}

// ---------- Project sync ----------
//
// Projects carry no blob fields (see storage.js -- the old templateBlob was
// retired), so a project doc is just the record itself, stripped of
// anything Firestore can't store (undefined values, functions) via the
// JSON round-trip below.

async function pushProjectToCompany(code, project) {
  const { db, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, setDoc } = await import(FIRESTORE_SDK);
  await ensureSignedIn();
  await setDoc(doc(db, 'companies', code, 'projects', project.id), JSON.parse(JSON.stringify(project)));
}

async function deleteProjectFromCompany(code, project) {
  const { db, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, deleteDoc } = await import(FIRESTORE_SDK);
  await ensureSignedIn();
  await deleteDoc(doc(db, 'companies', code, 'projects', project.id));
}

// ---------- Report sync ----------
//
// A report's photos/signature are the only blob fields -- they go to
// Storage at deterministic per-report paths (companies/{code}/reports/{id}/
// photo-N, .../signature), while the Firestore doc carries every other
// field plus which of those slots are actually filled (photoSlots,
// hasSignature), since slot position is meaningful (see local-folder-sync.js)
// and a doc can't hold Storage refs directly.

function reportPhotoPath(code, reportId, i) {
  return `companies/${code}/reports/${reportId}/photo-${i}`;
}
function reportSignaturePath(code, reportId) {
  return `companies/${code}/reports/${reportId}/signature`;
}

async function pushReportToCompany(code, report) {
  const { db, storage, ensureSignedIn } = await waitForFirebaseCore();
  const { doc, setDoc } = await import(FIRESTORE_SDK);
  const { ref, uploadBytes, deleteObject } = await import(STORAGE_SDK);
  await ensureSignedIn();

  const photos = report.photos || [];
  for (let i = 0; i < REPORT_PHOTO_SLOTS; i++) {
    const photoRef = ref(storage, reportPhotoPath(code, report.id, i));
    if (photos[i]) {
      await uploadBytes(photoRef, photos[i], { contentType: photos[i].type || 'image/jpeg' });
    } else {
      await deleteObject(photoRef).catch(() => {}); // wasn't there -- nothing to remove
    }
  }

  const sigRef = ref(storage, reportSignaturePath(code, report.id));
  if (report.repSignatureImage) {
    await uploadBytes(sigRef, report.repSignatureImage, { contentType: report.repSignatureImage.type || 'image/png' });
  } else {
    await deleteObject(sigRef).catch(() => {});
  }

  const { photos: _photos, repSignatureImage: _sig, peSignatureImage: _peSig, ...rest } = report;
  const data = JSON.parse(JSON.stringify(rest));
  data.photoSlots = photos.map((p) => !!p);
  data.hasSignature = !!report.repSignatureImage;
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

async function pullAllCompanyData(code) {
  const { db, storage, ensureSignedIn } = await waitForFirebaseCore();
  const { collection, getDocs } = await import(FIRESTORE_SDK);
  const { ref, getBytes } = await import(STORAGE_SDK);
  await ensureSignedIn();

  const summary = { projectsPulled: 0, reportsPulled: 0 };

  const projectsSnap = await getDocs(collection(db, 'companies', code, 'projects'));
  for (const d of projectsSnap.docs) {
    const result = await mergeProjectRecord({ ...d.data(), id: d.id });
    if (result !== 'skipped') summary.projectsPulled++;
  }

  const reportsSnap = await getDocs(collection(db, 'companies', code, 'reports'));
  for (const d of reportsSnap.docs) {
    const data = d.data();
    const report = { ...data, id: d.id };
    delete report.photoSlots;
    delete report.hasSignature;

    report.photos = [];
    for (let i = 0; i < REPORT_PHOTO_SLOTS; i++) {
      if (data.photoSlots && data.photoSlots[i]) {
        const bytes = await getBytes(ref(storage, reportPhotoPath(code, d.id, i)));
        report.photos.push(new Blob([bytes], { type: 'image/jpeg' }));
      } else {
        report.photos.push(null);
      }
    }
    report.repSignatureImage = data.hasSignature
      ? new Blob([await getBytes(ref(storage, reportSignaturePath(code, d.id)))], { type: 'image/png' })
      : null;

    const result = await mergeReportRecord(report);
    if (result !== 'skipped') summary.reportsPulled++;
  }

  return summary;
}

async function pushAllLocalData(code) {
  const projects = await getAllProjects();
  for (const project of projects) await pushProjectToCompany(code, project);

  const reports = await getAllReports();
  for (const report of reports) await pushReportToCompany(code, report);
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
