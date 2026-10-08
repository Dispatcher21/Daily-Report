# Emulator Tests

These suites run the real site in a headless browser against local Firebase
emulators (Auth, Firestore, Storage, Functions), so rules, sync, accounts
and emails get checked without touching either real Firebase project.

## Running

    tests/run.sh                      # every suite (about 30 to 40 minutes)
    tests/run.sh comment-emails team  # just these
    tests/run.sh --list               # the suite names

Each suite gets freshly started emulators. The runner prints one line per
suite and only the failing checks; full output for each is in
`tests/output/<suite>.log`, and screenshots land in `tests/output/` too.

When to run what:

- After a change: the suites that cover it.
- Right before a live push: all of them.

## What you need

- Node 22 or newer, and Java 11 or newer (the Firestore emulator).
- The first run installs the tools into `tests/node_modules` and
  `functions/node_modules` (a few hundred MB), and creates a placeholder
  `functions/.secret.local`, which the emulator needs. Real emails are
  never sent: in the emulator they land in a `devOutbox` collection.
- A Chromium: the preinstalled one at `/opt/pw-browsers/chromium` if
  present, `CHROMIUM_PATH` if set, otherwise run
  `npx playwright install chromium` once.

## How it fits together

- `site-server.js` serves this repo on http://127.0.0.1:8126, pointing
  `firebase-init.js` at the emulators and dropping the CSP so the pages may
  reach them. The repo files themselves aren't changed.
- `harness.js` launches the browser, swaps the gstatic Firebase SDK for the
  same version from npm, and wipes the emulators between runs.
- `emulator/firebase.json` runs the emulators with the repo's real
  `firestore.rules` and `functions/` (both linked in), and a simple Storage
  rules stand-in.
- `suites/*.js`: one file per area. Each prints `PASS`/`FAIL` per check and
  `ALL PASSED` at the end.

| Suite | Covers |
|---|---|
| access-rules | The Firestore rules once accounts are required: project limits, roles, who can edit what |
| baseline | The site talks to the emulators; a second device sees the company's projects |
| accounts | Creating accounts, signing in, joining a company |
| team | The Team list: roles, project limits, approvals, removing people |
| company-password-change | Changing the company password moves everyone and everything over |
| full-app | Every company feature that talks to Firebase, end to end |
| ui | Sign-in, joining and Settings screens, on phone and desktop sizes |
| team-ui | The Team screens, approvals and the waiting screen, on phone and desktop |
| auth-action-page | The page that links in older account emails open |
| comment-emails | Comment, reply and approval emails go to the right people |
| reset-codes | Forgot password and admin-sent reset codes |
| weekly-roundup | Roundup contents, alerts, week and time zone math, preview button |
| account-emails | Join request, approved, invite and password-changed emails |
| admin-alerts | Admin security and problem emails, and the company-wide roundup |
| offline | No signal: the offline bar and its count, pages (with ?project=... addresses) and the Firebase SDK load from the saved copy, the sign-in page doesn't hang, a report saved offline uploads by itself when the signal returns |
| quantities | Quantities, Log Quantities and Pay Apps pages: logged vs billed, item history, Excel, phone layout; the report editor's Pay Items (calculators, remarks, printed detail lines); pay item units in Project Settings and the project Excel file; the printed Work Summary box; Tests Performed and Checks Completed (tutorial project) |

## Known quirk

Now and then the emulators stall while a suite is setting up, before any
check runs. The runner notices (no `PASS`/`FAIL` lines) and retries that
suite once. A suite that fails a real check is never retried.
