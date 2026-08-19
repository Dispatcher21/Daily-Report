// Thin wrapper around the Microsoft Graph endpoints this app actually uses.
// Every function takes a fresh access token as its first argument -- this
// file has no idea how sign-in or token refresh works, that's
// onedrive-auth.js's job. Keeping the two apart means the sync engine can
// be handed a valid token from wherever and this code never has to care.
//
// Everything is addressed relative to the app's own dedicated OneDrive
// folder (the "app folder"), which is what the Files.ReadWrite.AppFolder
// permission scopes access down to -- this app can never see or touch
// anything else in an inspector's OneDrive, and an inspector never has to
// wonder what they just granted access to.

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const APP_FOLDER_REF = '/me/drive/special/approot';

async function graphFetch(accessToken, path, options) {
  const res = await fetch(GRAPH_ROOT + path, Object.assign({}, options, {
    headers: Object.assign({ Authorization: `Bearer ${accessToken}` }, (options && options.headers) || {}),
  }));
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OneDrive request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res;
}

// Graph's colon-path addressing (":/a/b:") needs each segment percent-
// encoded, but not the "/" separators between them.
function encodeGraphPath(path) {
  return path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

function statusFrom(err) {
  const m = /\((\d+)\)/.exec(err.message || '');
  return m ? Number(m[1]) : null;
}

// Creates a folder at `parentPath/name` (parentPath relative to the app
// folder root, '' for the app folder itself). Silently does nothing if it
// already exists.
async function ensureOneDriveFolder(accessToken, parentPath, name) {
  const parentRef = parentPath ? `${APP_FOLDER_REF}:/${encodeGraphPath(parentPath)}:` : APP_FOLDER_REF;
  try {
    await graphFetch(accessToken, `${parentRef}/children`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
    });
  } catch (err) {
    if (statusFrom(err) !== 409) throw err; // 409 = already there, which is fine
  }
}

// Walks a slash-separated path, creating every folder along it that
// doesn't already exist yet. Graph's simple upload endpoint isn't
// documented to auto-create missing parent folders, so this is done
// explicitly rather than assumed -- a folder path like
// "Reports/2026-08 (August)/2026-08-19" needs three separate checks.
async function ensureOneDrivePath(accessToken, path) {
  const segments = path.split('/').filter(Boolean);
  let parent = '';
  for (const seg of segments) {
    await ensureOneDriveFolder(accessToken, parent, seg);
    parent = parent ? `${parent}/${seg}` : seg;
  }
}

// Uploads (or overwrites) a file at `path`, relative to the app folder.
// Graph's "simple upload" endpoint this uses tops out at 4MB, which is
// comfortable for a report PDF, one photo, or the master spreadsheet --
// nothing this app syncs is expected to get close to that.
async function uploadOneDriveFile(accessToken, path, blob) {
  const ref = `${APP_FOLDER_REF}:/${encodeGraphPath(path)}:/content`;
  await graphFetch(accessToken, ref, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
}

async function downloadOneDriveFile(accessToken, path) {
  const ref = `${APP_FOLDER_REF}:/${encodeGraphPath(path)}:/content`;
  const res = await graphFetch(accessToken, ref, { method: 'GET' });
  return res.blob();
}

// Lists the immediate children of a folder (path relative to the app
// folder root, '' for the app folder itself). Returns [] rather than
// throwing when the folder doesn't exist -- "nothing has synced here yet"
// isn't an error state, it's the normal first-run condition.
async function listOneDriveFolder(accessToken, path) {
  const ref = path ? `${APP_FOLDER_REF}:/${encodeGraphPath(path)}:/children` : `${APP_FOLDER_REF}/children`;
  try {
    const res = await graphFetch(accessToken, ref, { method: 'GET' });
    const data = await res.json();
    return data.value || [];
  } catch (err) {
    if (statusFrom(err) === 404) return [];
    throw err;
  }
}
