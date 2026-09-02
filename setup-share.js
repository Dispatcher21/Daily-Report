// Receiving a setup someone else shared with this device.
//
// The payload is projects + the company logo -- never reports or photos,
// which are that inspector's own work and often large. It arrives as a
// `#setup=...` URL fragment (see index.html), base64url-encoded and
// optionally gzip-compressed. Fragments are used rather than query strings
// because a fragment is never sent to the server, so shared setups stay off
// GitHub's logs.
//
// There's no way to *create* one of these from within the app any more --
// whatever screen used to build the link/QR/card for the sending side was
// removed. This file only needs to be able to read one.

const SETUP_FRAGMENT_KEY = 'setup';

function base64UrlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Prefixed with the encoding so an older or CompressionStream-less browser can
// still read a payload it couldn't have produced. 'g' gzipped, 'r' raw.
async function decodeSetupPayload(encoded) {
  const kind = encoded[0];
  const bytes = base64UrlToBytes(encoded.slice(1));
  const raw = kind === 'g' ? await gunzip(bytes) : bytes;
  return JSON.parse(new TextDecoder().decode(raw));
}

function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(',');
  const mime = (head.match(/data:([^;]+)/) || [, 'application/octet-stream'])[1];
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
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
  const room = typeof getCompanyRoom === 'function' ? await getCompanyRoom() : null;
  const existing = (await getAllProjects()).filter((p) => typeof projectInScope !== 'function' || projectInScope(p, room));
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
