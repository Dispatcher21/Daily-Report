// Shared bits for the emulator suites: a browser, a page context that loads
// the real Firebase 10.14.1 SDK from npm in place of gstatic, a way to wipe
// the emulators between runs, and the folder screenshots go to.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const SITE = 'http://127.0.0.1:8126';
const PROJECT = 'daily-reports-test';
const FIREBASE_SDK = path.dirname(require.resolve('firebase/package.json'));

function loadPlaywright() {
  try { return require('playwright'); } catch { return require('/opt/node22/lib/node_modules/playwright'); }
}

// CHROMIUM_PATH overrides; otherwise a preinstalled one if there is one,
// else Playwright's own download.
async function launchBrowser() {
  const { chromium } = loadPlaywright();
  const exe = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  return chromium.launch(exe ? { executablePath: exe } : {});
}

async function emulatorContext(browser, opts = {}) {
  const ctx = await browser.newContext(opts);
  await ctx.route('https://www.gstatic.com/firebasejs/10.14.1/*', (r) => {
    const file = path.basename(new URL(r.request().url()).pathname);
    r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(FIREBASE_SDK, file), 'utf8') });
  });
  return ctx;
}

async function clearEmulators() {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

module.exports = { OUT, SITE, PROJECT, devices: loadPlaywright().devices, launchBrowser, emulatorContext, clearEmulators };
