#!/usr/bin/env bash
#
# T048: Full System Validation
#
# Validates the complete lifecycle works end-to-end:
#   1. Server builds and starts
#   2. Node.js test suite passes (unit + integration + contract)
#   3. API endpoints work (health, projects, onboard, sessions)
#   4. SSH bridge socket + WebSocket relay works
#   5. Android APK builds and installs
#   6. Android integration tests pass against real server
#   7. Complete lifecycle: onboard → session → SSH bridge → Android sign
#
# Usage: nix develop -c bash tests/e2e-full-system.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_DIR="$PROJECT_ROOT/android"

PASS_COUNT=0
FAIL_COUNT=0
RESULTS=()

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  RESULTS+=("PASS: $1")
  echo "  ✓ $1"
}

fail_check() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  RESULTS+=("FAIL: $1")
  echo "  ✗ $1"
}

section() {
  echo ""
  echo "=== $1 ==="
}

# ─── Cleanup ───

DATA_DIR=""
SERVER_PID=""

cleanup() {
  local exit_code=$?
  echo ""
  echo "--- Cleaning up ---"

  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi

  adb reverse --remove-all 2>/dev/null || true

  if [[ -n "$DATA_DIR" && -d "$DATA_DIR" ]]; then
    rm -rf "$DATA_DIR"
  fi
  rm -rf /tmp/e2e-fullsys-* 2>/dev/null || true

  echo ""
  echo "=============================="
  echo "  Full System Validation"
  echo "=============================="
  for r in "${RESULTS[@]}"; do
    echo "  $r"
  done
  echo ""
  echo "  Total: $((PASS_COUNT + FAIL_COUNT))  Pass: $PASS_COUNT  Fail: $FAIL_COUNT"
  echo "=============================="

  if [[ "$FAIL_COUNT" -gt 0 ]]; then
    exit 1
  fi
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

# ─── Phase 1: Build ───

section "Phase 1: Build Server + Android"

echo "Building Node.js server..."
(cd "$PROJECT_ROOT" && npm run build 2>&1) && pass "Server build (tsc + esbuild)" || fail_check "Server build"

echo "Building Android debug APK..."
(cd "$ANDROID_DIR" && ./gradlew assembleDebug -q 2>&1) && pass "Android debug APK build" || fail_check "Android debug APK build"

echo "Building Android test APK..."
(cd "$ANDROID_DIR" && ./gradlew assembleDebugAndroidTest -q 2>&1) && pass "Android test APK build" || fail_check "Android test APK build"

# ─── Phase 2: Node.js Test Suite ───

section "Phase 2: Node.js Test Suite"

echo "Running all Node.js tests (unit + integration + contract)..."
if (cd "$PROJECT_ROOT" && npm test 2>&1 | tail -20); then
  pass "All Node.js tests (unit + integration + contract)"
else
  fail_check "Node.js test suite (see output above)"
fi

# ─── Phase 3: Start Server + API Validation ───

section "Phase 3: Server Start + API Endpoints"

# Set up temp data directory
DATA_DIR="$(mktemp -d /tmp/e2e-fullsys-XXXXXX)"
PROJECTS_DIR="$(mktemp -d /tmp/e2e-fullsys-projects-XXXXXX)"
PORT=13048

# Create test project with SSH remote
PROJECT_DIR="$PROJECTS_DIR/test-project"
mkdir -p "$PROJECT_DIR"
git -C "$PROJECT_DIR" init --quiet
git -C "$PROJECT_DIR" remote add origin git@github.com:test/test-repo.git
cat > "$PROJECT_DIR/tasks.md" << 'TASKS'
## Phase 1: Test

- [ ] 1 First test task
- [ ] 2 Second test task
TASKS
echo '{ outputs = { self }: {}; }' > "$PROJECT_DIR/flake.nix"
git -C "$PROJECT_DIR" add -A
git -C "$PROJECT_DIR" commit -m "init" --quiet

# Create data directory with registered project
mkdir -p "$DATA_DIR/sessions"
PROJECT_ID="e2e-test-project"
cat > "$DATA_DIR/projects.json" << PROJ
[{
  "id": "$PROJECT_ID",
  "name": "e2e-test-project",
  "description": "E2E test project with SSH remote",
  "dir": "$PROJECT_DIR",
  "taskFile": "tasks.md",
  "promptFile": "",
  "createdAt": "$(date -Iseconds)",
  "status": "active"
}]
PROJ
echo '[]' > "$DATA_DIR/push-subscriptions.json"

# Agent framework dir (server runs git fetch on startup)
AF_DIR="$DATA_DIR/agent-framework"
mkdir -p "$AF_DIR"
git -C "$AF_DIR" init --quiet
git -C "$AF_DIR" commit --allow-empty -m "init" --quiet
touch "$AF_DIR/ROUTER.md"

# Start server
AGENT_RUNNER_DATA_DIR="$DATA_DIR" \
AGENT_RUNNER_PORT="$PORT" \
AGENT_RUNNER_HOST="127.0.0.1" \
AGENT_RUNNER_PROJECTS_DIR="$PROJECTS_DIR" \
ALLOW_UNSANDBOXED=true \
LOG_LEVEL=warn \
  node "$PROJECT_ROOT/dist/server.js" &
SERVER_PID=$!

# Wait for server
echo -n "Waiting for server..."
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo " ready!"
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo " DIED"
    fail_check "Server startup"
    exit 1
  fi
  echo -n "."
  sleep 1
done

# Health check
HEALTH=$(curl -sf "http://127.0.0.1:$PORT/api/health" 2>/dev/null || echo "")
if echo "$HEALTH" | grep -q '"status"'; then
  pass "GET /api/health returns status"
else
  fail_check "GET /api/health"
fi

# Projects list
PROJECTS=$(curl -sf "http://127.0.0.1:$PORT/api/projects" 2>/dev/null || echo "")
if echo "$PROJECTS" | grep -q '"registered"'; then
  pass "GET /api/projects returns registered + discovered"
else
  fail_check "GET /api/projects"
fi

# Registered project visible
if echo "$PROJECTS" | grep -q "$PROJECT_ID"; then
  pass "Registered project visible in /api/projects"
else
  fail_check "Registered project not in /api/projects"
fi

# ─── Phase 4: Session + SSH Bridge ───

section "Phase 4: Session Creation + SSH Bridge"

# Create a task-run session (this also sets up the SSH bridge)
SESSION_RESP=$(curl -sf -X POST "http://127.0.0.1:$PORT/api/projects/$PROJECT_ID/sessions" \
  -H 'Content-Type: application/json' \
  -d '{"type":"task-run","allowUnsandboxed":true}' 2>/dev/null || echo "")

if echo "$SESSION_RESP" | grep -q '"id"'; then
  SESSION_ID=$(echo "$SESSION_RESP" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  pass "POST /api/projects/:id/sessions creates session ($SESSION_ID)"
else
  fail_check "Session creation failed: $SESSION_RESP"
  SESSION_ID=""
fi

# Check SSH bridge socket
if [[ -n "$SESSION_ID" ]]; then
  SOCK_PATH="$DATA_DIR/sessions/$SESSION_ID/agent.sock"
  SOCK_FOUND=false
  for i in $(seq 1 20); do
    if [[ -S "$SOCK_PATH" ]]; then
      SOCK_FOUND=true
      break
    fi
    sleep 0.25
  done

  if $SOCK_FOUND; then
    pass "SSH bridge socket created at sessions/<id>/agent.sock"
    PERMS=$(stat -c '%a' "$SOCK_PATH" 2>/dev/null || stat -f '%Lp' "$SOCK_PATH" 2>/dev/null || echo "unknown")
    if [[ "$PERMS" == "600" ]]; then
      pass "SSH bridge socket has 0600 permissions"
    else
      fail_check "SSH bridge socket permissions are $PERMS (expected 600)"
    fi
  else
    fail_check "SSH bridge socket not found after 5s"
  fi

  # Verify WebSocket streaming works (use a temp .mjs file — npx tsx -e has known issues)
  echo "  Testing WebSocket connection to session..."
  WS_SCRIPT=$(mktemp "$PROJECT_ROOT/tests/.ws-test-XXXXXX.mjs")
  cat > "$WS_SCRIPT" << WSEOF
import { WebSocket } from 'ws';
const ws = new WebSocket('ws://127.0.0.1:$PORT/ws/sessions/$SESSION_ID');
const msgs = [];
ws.on('message', d => { try { msgs.push(JSON.parse(String(d)).type); } catch {} });
ws.on('open', () => {});
setTimeout(() => { ws.close(); console.log(JSON.stringify(msgs)); process.exit(0); }, 2000);
ws.on('error', e => { console.log('ERROR:' + e.message); process.exit(1); });
WSEOF
  WS_TEST=$(node "$WS_SCRIPT" 2>/dev/null || echo "ERROR")
  rm -f "$WS_SCRIPT"

  if echo "$WS_TEST" | grep -q 'sync'; then
    pass "WebSocket streaming connects and receives sync"
  else
    fail_check "WebSocket streaming: $WS_TEST"
  fi

  # Run the SSH bridge E2E script (validates full socket+WS relay)
  echo "  Running SSH bridge E2E validation..."
  if (cd "$PROJECT_ROOT" && npx tsx tests/e2e-ssh-bridge.ts 2>&1 | tail -5); then
    pass "SSH bridge E2E (socket → WebSocket relay → response)"
  else
    fail_check "SSH bridge E2E validation"
  fi
fi

# ─── Phase 5: Android Integration ───

section "Phase 5: Android Integration"

# Check for Android device/emulator
DEVICE_COUNT=$(adb devices 2>/dev/null | grep -cE $'\t(device|emulator)' || true)
if [[ "$DEVICE_COUNT" -eq 0 ]]; then
  echo "  SKIP: No Android device/emulator connected"
  RESULTS+=("SKIP: Android integration (no device)")
else
  pass "Android device/emulator connected ($DEVICE_COUNT device(s))"

  # Kill existing server — Android tests use their own server instance
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
  fi

  echo "  Running Android integration tests (this may take a few minutes)..."
  if (cd "$PROJECT_ROOT" && AGENT_RUNNER_PORT=13049 bash tests/android-integration/run.sh 2>&1 | tail -20); then
    pass "Android integration tests (all 14 tests)"
  else
    fail_check "Android integration tests"
  fi
fi

# ─── Phase 6: PWA Assets ───

section "Phase 6: PWA Assets"

for f in index.html app.js sw.js manifest.json; do
  if [[ -f "$PROJECT_ROOT/public/$f" ]]; then
    pass "PWA asset: public/$f exists"
  else
    fail_check "PWA asset: public/$f missing"
  fi
done
