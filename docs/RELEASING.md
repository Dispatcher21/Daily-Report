# Releasing to the Live Site

How a change gets from the test branch to https://inspector-manager.com.
See `AGENTS.md` for the ground rules this follows.

## Pending Firebase changes

Everything waiting to be applied to the live Firebase project
(`daily-reports-53c82`). Add to this list as you go; clear it once the
owner has applied it.

- **Rules: approved reports are locked.** `firestore.rules` now refuses
  changes to an approved report's content (from any app version, in both
  sign-in modes) until a Manager or admin unlocks it. Comments and
  unlock requests still go through. Publish before the app that has the
  Unlock button goes live, so old phones can't overwrite approved
  reports.
- Functions: `weeklyRoundup` and `sendRoundupPreview` (contract days
  used and left follow each project's Working days / Calendar days
  setting, via the new `functions/lib/contract-time.js`).

Future idea, not scheduled: move Pay Apps out of the project document
into their own records (`companies/{code}/payApps`). Then the rules could
lock approved Pay Apps the same way they lock reports. Today the lock is
in the app plus a sync guard that keeps the cloud's approved copy.

(Last applied: 0.057, 2026-10-07: rules for devices without an account
(approval, assigned projects only); onMemberWritten. 0.054, 2026-10-07: weeklyRoundup and sendRoundupPreview
(Lump Sum by confirmed unit). 0.053, 2026-10-06: every function on Node.js 22.
0.0521, 2026-10-06: rules with
separate approve and comment permissions; onCompanyUpdated redeployed.
0.052: weeklyRoundup and sendRoundupPreview. 0.051: rules with the
`problems` section; every email function.)

## The checklist

Always in this order. Firebase first, so the new app never runs against
old rules or missing functions.

### 1. Rules (only if `firestore.rules` changed)

From Google Cloud Shell:

    cd ~/Daily-Report && git pull && npx -y firebase-tools@latest deploy --only firestore:rules --project daily-reports-53c82

Or paste the whole of `firestore.rules` into the Firebase console
(Firestore, Rules) and click Publish.

### 2. Functions (only if `functions/` changed)

    cd ~/Daily-Report && git pull && npx -y firebase-tools@latest deploy --only functions --project daily-reports-53c82

- If it asks to enable an API (such as Cloud Scheduler) or to create new
  functions, say yes.
- If some functions fail to create on the first try (common when adding
  several at once), deploy just those again:
  `--only functions:nameOne,functions:nameTwo`.
- The `RESEND_API_KEY` secret and `functions/.env` are already set up.

### 3. The app

1. Run the full test suite: `tests/run.sh`.
2. On the test branch: bump `APP_VERSION` (`common.js`, the owner picks the
   number) and `CACHE_NAME` (`service-worker.js`, always +1), and add the
   `patch-notes.txt` entry.
3. Get the owner's go-ahead.
4. Copy the test branch onto `main`, minus the Cloudflare-only files:

       git fetch origin main <test-branch>
       git checkout -B release origin/main
       git checkout origin/<test-branch> -- .
       git rm --cached --ignore-unmatch .assetsignore cloudflare-worker.js wrangler.jsonc
       rm -f .assetsignore cloudflare-worker.js wrangler.jsonc
       git commit -m "<summary> (<version>)"
       git push origin release:main

5. Check the site: after a refresh or two, the bottom of Settings shows the
   new version.

## Backups

The live Firestore data is exported to `gs://daily-reports-53c82-backups`.
Take a fresh export before any risky rules or data change.

## The test project

`daily-reports-test` backs the test site. It doesn't have to match live.
To bring it up to date, run the same commands with
`--project daily-reports-test`.
