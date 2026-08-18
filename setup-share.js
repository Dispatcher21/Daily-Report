// Sharing a configured setup with another inspector.
//
// The payload is projects + the company logo -- never reports or photos, which
// are that inspector's own work and often large. It travels two ways:
//
//   * a self-contained .html "setup card" that carries the logo and hands the
//     payload to the hosted app as a URL fragment. The URL is built locally in
//     the recipient's browser, so the ~2,000-character ceiling that email and
//     SMS impose on links never applies -- the data arrived as a file.
//   * a QR code for settings only. A QR tops out near 2,900 bytes, which fits
//     project data comfortably but cannot fit a logo at print quality.
//
// Fragments are used rather than query strings because a fragment is never
// sent to the server, so shared setups stay off GitHub's logs.

const SETUP_FRAGMENT_KEY = 'setup';

// base64url, so the payload survives a URL without percent-encoding.
function bytesToBase64Url(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function gzip(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Prefixed with the encoding so an older or CompressionStream-less browser can
// still read a payload it couldn't have produced. 'g' gzipped, 'r' raw.
async function encodeSetupPayload(payload) {
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  const packed = await gzip(raw);
  return packed ? 'g' + bytesToBase64Url(packed) : 'r' + bytesToBase64Url(raw);
}

async function decodeSetupPayload(encoded) {
  const kind = encoded[0];
  const bytes = base64UrlToBytes(encoded.slice(1));
  const raw = kind === 'g' ? await gunzip(bytes) : bytes;
  return JSON.parse(new TextDecoder().decode(raw));
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(',');
  const mime = (head.match(/data:([^;]+)/) || [, 'application/octet-stream'])[1];
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// `includeLogo` is false for QR codes, where it would blow the size budget.
async function buildSetupPayload({ includeLogo }) {
  const projects = (await getAllProjects()).map((p) => ({
    id: p.id,
    name: p.name,
    meta: p.meta,
    payItemCatalog: p.payItemCatalog || [],
    defaultContractors: p.defaultContractors || [],
    defaultEquipmentLabels: p.defaultEquipmentLabels || [],
  }));

  const payload = { v: 1, projects };
  if (includeLogo) {
    const logo = await getReportLogo();
    if (logo) {
      payload.logo = await blobToDataUrl(logo);
    }
  }
  return payload;
}

function describeSetupPayload(payload) {
  const projects = (payload && payload.projects) || [];
  const lines = projects.slice(0, 6).map((p) => {
    const items = (p.payItemCatalog || []).length;
    return `  • ${p.name}${items ? ` (${items} pay items)` : ''}`;
  });
  if (projects.length > 6) lines.push(`  • ...and ${projects.length - 6} more`);
  if (payload && payload.logo) lines.push('  • Company logo');
  return lines.join('\n');
}

// Applies a received setup. Projects are matched by id: an existing one is
// updated, a new one added. Reports are never touched, and a logo already set
// on this device is left alone.
async function applySetupPayload(payload) {
  const existing = await getAllProjects();
  const byId = new Map(existing.map((p) => [p.id, p]));

  let added = 0;
  let updated = 0;
  for (const incoming of (payload && payload.projects) || []) {
    const current = byId.get(incoming.id);
    const project = Object.assign({}, current, incoming, {
      createdAt: current ? current.createdAt : Date.now(),
      updatedAt: Date.now(),
    });
    await putProjectRaw(project);
    if (current) updated++;
    else added++;
  }

  let logoAdded = false;
  if (payload && payload.logo && !(await getReportLogo())) {
    await saveReportLogo(dataUrlToBlob(payload.logo));
    logoAdded = true;
  }

  return { added, updated, logoAdded };
}

function setupUrlFor(encoded, base) {
  const origin = base || location.href.split('#')[0].replace(/[^/]*$/, '') + 'index.html';
  return `${origin}#${SETUP_FRAGMENT_KEY}=${encoded}`;
}

// A standalone page that carries the payload and hands it to the app. Phones
// open .html attachments in a browser, which is the whole reason this exists
// rather than shipping the raw JSON -- a .json attachment just offers to save.
function buildSetupCardHtml(encoded, appUrl, summaryHtml) {
  const target = `${appUrl}#${SETUP_FRAGMENT_KEY}=${encoded}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daily Reports setup</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #eef2f6; color: #10171d; padding: 1.25rem;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .card {
    background: #fff; border: 1px solid #c2ccd6; border-radius: 12px;
    padding: 1.5rem; max-width: 30rem; width: 100%;
    box-shadow: 0 6px 20px rgba(16,23,29,.14);
  }
  h1 { font-size: 1.2rem; margin: 0 0 .3rem; }
  .sub { color: #4f5c68; font-size: .88rem; margin-bottom: 1rem; }
  ul { margin: 0 0 1.25rem; padding-left: 1.1rem; font-size: .92rem; line-height: 1.6; }
  a.go {
    display: block; text-align: center; background: #1c3d5a; color: #fff;
    text-decoration: none; font-weight: 700; font-size: 1.05rem;
    padding: .95rem; border-radius: 8px; min-height: 44px;
  }
  .note { font-size: .78rem; color: #4f5c68; margin-top: .9rem; }
  @media (prefers-color-scheme: dark) {
    body { background: #0f1418; color: #eef3f7; }
    .card { background: #1a2128; border-color: #35424e; }
    .sub, .note { color: #a2b1be; }
    a.go { background: #1d4b70; }
  }
</style>
</head>
<body>
  <div class="card">
    <h1>Daily Reports setup</h1>
    <div class="sub">Someone shared their project setup with you.</div>
    <ul>${summaryHtml}</ul>
    <a class="go" href="${target}">Open &amp; Add to My App</a>
    <p class="note">Opens the Daily Reports app and asks before adding anything. Your own reports aren't affected.</p>
  </div>
</body>
</html>`;
}
