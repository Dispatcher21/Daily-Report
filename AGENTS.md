# Daily Work Reports: Guide for Contributors

Read this first, whether you're a person or an AI coding tool. It covers how
the project is set up, the rules that keep the live site safe, and where to
find everything else.

More detail lives in:

- `APP-BREAKDOWN.txt`: a file-by-file map of the app, its data model, and
  the main workflows traced end to end.
- `docs/RELEASING.md`: how changes get to the live site, plus the running
  list of Firebase changes waiting to go live.
- `tests/README.md`: the emulator test suites and how to run them.
- `patch-notes.txt`: what changed in each version, newest first. The app
  links to it from the version number at the bottom of Settings.

## What the app is

A Progressive Web App for field inspection daily reports: projects, daily
reports with photos and signatures, pay items and quantities, Pay Apps,
dashboards. Plain HTML, CSS and JavaScript with no build step. It works
offline, keeping everything on the device in IndexedDB. Optionally, a team
shares a "company" through Firebase (Firestore, Storage, Auth), with a few
Cloud Functions for email.

## The two environments

|                  | Live                          | Test                                             |
|------------------|-------------------------------|--------------------------------------------------|
| Site             | https://inspector-manager.com | https://daily-report.john-sonnieriii.workers.dev |
| Branch           | `main`                        | the working branch (currently `claude/sweet-maxwell-fl5w5j`) |
| Hosted by        | GitHub Pages (`CNAME`)        | Cloudflare Workers (`wrangler.jsonc`, `cloudflare-worker.js`) |
| Firebase project | `daily-reports-53c82`         | `daily-reports-test`                             |

`firebase-init.js` chooses the Firebase project by hostname (`TEST_HOSTS`).
The test site always stays on the test project. Never point it at live
data: the test site runs code before it's been checked, and a bug there
must not be able to touch real reports.

The test project is a sandbox. Its rules and functions can lag behind live;
the emulator tests are what check rules and functions before they ship.

## Ground rules

1. **Nothing goes to `main` without the owner's explicit go-ahead.** Work
   on the test branch, let the owner try it on the test site, and push to
   `main` only when they say so.
2. **Every push to `main`:** bump `APP_VERSION` in `common.js` (a display
   label only; the owner picks the number, for example `0.0511` for a small
   hotfix), bump `CACHE_NAME` in `service-worker.js` (this is what makes
   installed apps pick up the update), and add a `patch-notes.txt` entry.
3. **Live reliability comes first.** When unsure, choose the change that
   can't lose data or lock anyone out, and say what the risk is.
4. **No em dashes**, anywhere: UI text, emails, docs, comments, commit
   messages. Use commas, colons, parentheses or "--" instead.
5. **Emails contain no links** (work email filters treat links from a new
   sender as phishing). Plain words, telling people where in the app to go.
6. **Never commit secrets.** The Resend API key is a Firebase secret
   (`RESEND_API_KEY`); `functions/.secret.local` is for the emulator only
   and is git-ignored.
7. **Firebase changes are collected, not drip-fed.** The owner applies
   rules and functions changes in one batch before a live push. Add every
   pending change to the list in `docs/RELEASING.md` as you make it.

## Working with the owner

- The owner deploys from Google Cloud Shell and the Firebase console. Give
  instructions one step at a time, with exact commands to copy.
- Keep updates short. Report test results in a line ("all 14 suites
  pass"), not test plumbing.
- After a change, run only the suites that cover it. Run the full suite
  once right before a live push.

## How the code is organized

- **Pages** are standalone HTML files, each with its own inline script.
- **Shared code** is classic scripts loaded with `<script src>` that define
  plain globals: `storage.js` (IndexedDB), `common.js`, `defaults.js`,
  `firebase-sync.js` (everything company and account related),
  `audit-log.js`, `quantity-calc.js`, `quantities-ui.js` (logged vs billed,
  shared by Quantities, Pay Apps and the project page), and others. Load
  order matters.
- **`firebase-init.js`** is the only ES module (the Firebase SDK needs it).
  It exposes `window.FirebaseCore`, which other code reaches through
  `waitForFirebaseCore()`.
- **`service-worker.js`** precaches the app shell for offline use.
- Match the style around you: comment density, naming, plain functions.

### Firebase layout

- `companies/{code}`: a company. `code` is the SHA-256 of the company
  password. Subcollections: `members` (accounts, roles, status, project
  limits), `projects`, `reports`, `auditLog`, `userLayouts`,
  `deletedProjects`, `deletedReports`, `problems` (write-only notes for the
  admin problem emails), `roles` (retired custom setups).
- `users/{uid}`: each account's own profile and email preferences.
- `invites/{email}`: pre-approved emails.
- `emailCodes`, `adminAlerts`: server-only (no client access).
- **Rules:** `firestore.rules` in the repo root is the official copy. See
  `docs/RELEASING.md` for publishing it.
- **Roles:** admins can do everything; what Inspectors and Managers can do
  comes from the Roles table (`rolePermissions` on the company doc), and
  the rules enforce it once the company turns on "Require everyone to sign
  in" (`accountsRequired`).

### Cloud Functions (`functions/`)

Node 22, region `us-central1`. All email goes through Resend
(`sendEmail` in `functions/index.js`); the sender is `MAIL_FROM` in
`functions/.env`.

- Comment, reply and approval emails: `onReportComment`, `onPayAppComment`.
- Password reset by emailed code: `sendResetCode`, `adminSendResetCode`,
  `resetPasswordWithCode`.
- Weekly roundup (Tuesdays 6:30 AM in each person's time zone):
  `weeklyRoundup`, `sendRoundupPreview`, built by `functions/roundup.js`.
- Account emails: `onMemberWritten` (join requests, approvals),
  `onInviteCreated`, `passwordChangedNotice`.
- Admin emails: `onCompanyUpdated`, `onProjectDeleted`,
  `onProblemReported`, `adminAlertDigest` (every 15 minutes).

`functions/lib/quantity-calc.js` is a copy of the app's `quantity-calc.js`
so the roundup's numbers match the dashboards. **Re-copy it whenever
`quantity-calc.js` changes.**

In the emulator, `sendEmail` writes to a `devOutbox` collection instead of
sending, so the tests can read every email.

## Keeping docs current

- New file, new shared function, or a change to sync or the data model:
  update `APP-BREAKDOWN.txt`.
- New rules or functions waiting to go live: add them to the pending list
  in `docs/RELEASING.md`.
- New feature: add or extend a suite in `tests/suites/`.
- Every live push: `patch-notes.txt`.
