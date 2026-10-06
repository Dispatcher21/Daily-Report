#!/bin/bash
# Runs the emulator suites against the real site. See tests/README.md.
#
#   tests/run.sh                    every suite
#   tests/run.sh comment-emails     just the ones named (file names in suites/, no .js)
#   tests/run.sh --list             list the suites
#
# Each suite gets freshly started emulators. Prints only failures and a
# one-line result per suite; full output is in tests/output/<suite>.log.
cd "$(dirname "$0")" || exit 1
TESTS="$PWD"
REPO="$(cd .. && pwd)"

if [ "$1" = "--list" ]; then ls suites | sed 's/\.js$//'; exit 0; fi
SUITES=("$@")
if [ ${#SUITES[@]} -eq 0 ]; then
  # The order they've always run in: rules first, then features.
  SUITES=(access-rules baseline accounts team company-password-change full-app ui team-ui auth-action-page comment-emails reset-codes weekly-roundup account-emails admin-alerts)
fi

# ---------- one-time setup ----------
[ -d node_modules ] || { echo "Installing test tools (one time)..."; npm install --silent || exit 1; }
[ -d "$REPO/functions/node_modules" ] || { echo "Installing functions packages (one time)..."; (cd "$REPO/functions" && npm install --silent) || exit 1; }
# The emulator asks for the email key; any value works (emails go to the devOutbox collection).
[ -f "$REPO/functions/.secret.local" ] || echo "RESEND_API_KEY=emulator-only" > "$REPO/functions/.secret.local"
mkdir -p output

stop_emulators() {
  for p in $(ps aux | grep -E "emulators:start|cloud-firestore-emulator|storage_rules" | grep -v grep | awk '{print $2}'); do kill "$p" 2>/dev/null; done
  for _ in $(seq 1 20); do curl -s -o /dev/null -m 1 http://127.0.0.1:8080/ || break; sleep 1; done
  sleep 2
}
start_emulators() {
  # Without any HTTP proxy settings: the emulators talk to each other on localhost.
  (cd emulator && env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy -u GLOBAL_AGENT_HTTPS_PROXY \
    nohup "$TESTS/node_modules/.bin/firebase" emulators:start --project daily-reports-test > "$TESTS/output/emulators.log" 2>&1 &)
  for _ in $(seq 1 90); do grep -q "All emulators ready" output/emulators.log 2>/dev/null && return 0; sleep 2; done
  echo "The emulators didn't start. See tests/output/emulators.log"; exit 1
}
curl -s -o /dev/null -m 2 http://127.0.0.1:8126/index.html || (nohup node site-server.js > output/site-server.log 2>&1 &)

# ---------- run ----------
failed=()
for t in "${SUITES[@]}"; do
  [ -f "suites/$t.js" ] || { echo "No suite named $t (tests/run.sh --list)"; failed+=("$t"); continue; }
  for attempt in 1 2; do
    stop_emulators; start_emulators
    SIMPLE_STORAGE=1 timeout 420 node "suites/$t.js" > "output/$t.log" 2>&1
    # A run that never got to a single check stalled during setup (an
    # occasional emulator hiccup, not a test result): try that once more.
    grep -qE "^(PASS|FAIL)" "output/$t.log" && break
    [ $attempt = 1 ] && echo "  ($t stalled during setup; retrying once)"
  done
  if grep -q "^ALL PASSED" "output/$t.log"; then
    echo "PASS  $t ($(grep -c '^PASS' "output/$t.log") checks)"
  else
    echo "FAIL  $t"
    grep -E "^FAIL|Error|error:" "output/$t.log" | grep -v "CONSOLE" | head -8 | sed 's/^/      /'
    failed+=("$t")
  fi
done
stop_emulators

echo
if [ ${#failed[@]} -eq 0 ]; then echo "All ${#SUITES[@]} suites passed."; else echo "${#failed[@]} failed: ${failed[*]}"; exit 1; fi
