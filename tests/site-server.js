// Serves the site from this repo on 127.0.0.1:8126 for the suites, pointed at
// the local emulators: firebase-init.js gets connect*Emulator calls added, and
// HTML pages lose their CSP meta so they may reach the emulator ports.
// Nothing in the repo is modified.
const http = require('http');
const fs = require('fs');
const path = require('path');

const SITE = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain' };
const SDK = 'https://www.gstatic.com/firebasejs/10.14.1';

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const file = path.join(SITE, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
  if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(file);
  if (u.pathname === '/firebase-init.js') {
    let src = body.toString();
    src = src.replace('import { getStorage } from', `import { connectStorageEmulator } from '${SDK}/firebase-storage.js';\nimport { connectFirestoreEmulator } from '${SDK}/firebase-firestore.js';\nimport { connectAuthEmulator } from '${SDK}/firebase-auth.js';\nimport { getStorage } from`);
    src = src.replace('const storage = getStorage(app);', "const storage = getStorage(app);\nconnectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });\nconnectFirestoreEmulator(db, '127.0.0.1', 8080);\nconnectStorageEmulator(storage, '127.0.0.1', 9199);");
    src = src.replace(`import { getFunctions, httpsCallable } from '${SDK}/firebase-functions.js';`, `import { getFunctions, httpsCallable, connectFunctionsEmulator } from '${SDK}/firebase-functions.js';`);
    src = src.replace('const callFunction =', "connectFunctionsEmulator(functions, '127.0.0.1', 5001);\nconst callFunction =");
    body = src;
  } else if (file.endsWith('.html')) {
    body = body.toString().replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
}).listen(8126, '127.0.0.1');
