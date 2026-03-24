#!/usr/bin/env bash
#
# Android integration test orchestration script (FR-107, FR-116)
#
# Starts a real agent-runner server with test fixtures in a temp data dir,
# sets up adb reverse port forwarding, installs the debug+test APKs,
# runs instrumented tests, pulls test-logs from device, and tears down.
#
# Usage: npm run test:android:integration
#   or:  bash tests/android-integration/run.sh
#
# Prerequisites:
#   - Android device/emulator connected (adb devices shows a device)
#   - nix develop environment (for node, npm, tsx)
#   - Android SDK available (for adb, gradlew)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ANDROID_DIR="$PROJECT_ROOT/android"
FIXTURES_DIR="$PROJECT_ROOT/tests/fixtures"
TEST_LOGS_DIR="$PROJECT_ROOT/test-logs/android-integration"
PORT="${AGENT_RUNNER_PORT:-3000}"

# Temp data dir for isolated server state
DATA_DIR=""
SERVER_PID=""

cleanup() {
  local exit_code=$?
  echo "--- Cleaning up ---"

  # Stop the server
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Stopping server (PID $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi

  # Remove adb reverse
  adb reverse --remove tcp:"$PORT" 2>/dev/null || true

  # Clean up temp data dir
  if [[ -n "$DATA_DIR" && -d "$DATA_DIR" ]]; then
    echo "Removing temp data dir: $DATA_DIR"
    rm -rf "$DATA_DIR"
  fi

  echo "--- Cleanup complete (exit code: $exit_code) ---"
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

# --- Preflight checks ---

echo "=== Android Integration Test Orchestration ==="
echo ""

# Check adb is available and a device is connected
if ! command -v adb &>/dev/null; then
  echo "ERROR: adb not found. Ensure Android SDK is available."
  exit 1
fi

DEVICE_COUNT=$(adb devices | grep -c -E '\t(device|emulator)')
if [[ "$DEVICE_COUNT" -eq 0 ]]; then
  echo "ERROR: No Android device/emulator connected. Run 'adb devices' to check."
  exit 1
fi
echo "✓ Android device connected ($DEVICE_COUNT device(s))"

# Check server is built
if [[ ! -f "$PROJECT_ROOT/dist/server.js" ]]; then
  echo "Building server..."
  (cd "$PROJECT_ROOT" && npm run build)
fi
echo "✓ Server built"

# --- Set up temp data dir with test fixtures ---

DATA_DIR="$(mktemp -d /tmp/agent-runner-android-test.XXXXXX)"
echo "Using temp data dir: $DATA_DIR"

# Copy test fixture projects.json (use projects-with-active for a realistic scenario)
cp "$FIXTURES_DIR/projects-with-active.json" "$DATA_DIR/projects.json"

# Create empty push-subscriptions.json
echo "[]" > "$DATA_DIR/push-subscriptions.json"

# Create a minimal agent-framework dir so the server doesn't try to clone
AGENT_FW_DIR="$DATA_DIR/agent-framework"
mkdir -p "$AGENT_FW_DIR"
git -C "$AGENT_FW_DIR" init --quiet
git -C "$AGENT_FW_DIR" commit --allow-empty -m "init" --quiet

# Create project directories referenced by the fixture
mkdir -p /tmp/agent-runner-test/projects/alpha
mkdir -p /tmp/agent-runner-test/projects/beta

echo "✓ Test fixtures prepared"

# --- Start the server ---

echo "Starting agent-runner server on port $PORT..."
AGENT_RUNNER_DATA_DIR="$DATA_DIR" \
AGENT_RUNNER_PORT="$PORT" \
AGENT_RUNNER_PROJECTS_DIR="/tmp/agent-runner-test/projects" \
ALLOW_UNSANDBOXED=true \
LOG_LEVEL=warn \
  node "$PROJECT_ROOT/dist/server.js" &
SERVER_PID=$!

# Wait for the server to be ready
echo -n "Waiting for server..."
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo " ready!"
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo ""
    echo "ERROR: Server process died during startup."
    exit 1
  fi
  echo -n "."
  sleep 1
done

# Final check
if ! curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo ""
  echo "ERROR: Server failed to start within 30 seconds."
  exit 1
fi
echo "✓ Server running (PID $SERVER_PID)"

# --- Set up adb reverse port forwarding ---

echo "Setting up adb reverse tcp:$PORT -> tcp:$PORT..."
adb reverse tcp:"$PORT" tcp:"$PORT"
echo "✓ adb reverse configured"

# --- Build and install Android APKs ---

echo "Building Android debug + test APKs..."
(cd "$ANDROID_DIR" && ./gradlew assembleDebug assembleDebugAndroidTest -q)
echo "✓ APKs built"

echo "Installing debug APK..."
adb install -r "$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"
echo "✓ Debug APK installed"

echo "Installing test APK..."
adb install -r "$ANDROID_DIR/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
echo "✓ Test APK installed"

# --- Clear previous test logs on device ---

DEVICE_TEST_LOGS_PATH="/sdcard/Android/data/com.agentrunner/files/test-logs/android-integration"
adb shell "rm -rf $DEVICE_TEST_LOGS_PATH" 2>/dev/null || true

# --- Run instrumented tests ---

echo ""
echo "=== Running Android instrumented tests ==="
echo ""

# Run via am instrument; capture exit code but don't fail immediately
set +e
adb shell am instrument -w \
  -e class "com.agentrunner" \
  com.agentrunner.test/androidx.test.runner.AndroidJUnitRunner 2>&1 | tee /tmp/android-instrument-output.txt
INSTRUMENT_EXIT=$?
set -e

echo ""
echo "=== Instrumented tests finished (exit: $INSTRUMENT_EXIT) ==="

# --- Pull test logs from device ---

echo "Pulling test logs from device..."
mkdir -p "$TEST_LOGS_DIR"

# Pull all test-logs from the app's external files dir
adb pull "$DEVICE_TEST_LOGS_PATH/" "$TEST_LOGS_DIR/" 2>/dev/null || {
  echo "WARNING: Could not pull test logs from device. Tests may not have produced output."
  # Also try the internal storage fallback path
  DEVICE_INTERNAL_PATH="/data/data/com.agentrunner/files/test-logs/android-integration"
  adb pull "$DEVICE_INTERNAL_PATH/" "$TEST_LOGS_DIR/" 2>/dev/null || true
}

# Find and display the latest summary
LATEST_SUMMARY=$(find "$TEST_LOGS_DIR" -name "summary.json" -type f 2>/dev/null | sort | tail -1)
if [[ -n "$LATEST_SUMMARY" ]]; then
  echo ""
  echo "=== Test Summary ==="
  cat "$LATEST_SUMMARY"
  echo ""
fi

# Save the raw instrument output alongside test logs
cp /tmp/android-instrument-output.txt "$TEST_LOGS_DIR/instrument-output.txt" 2>/dev/null || true

# --- Determine overall result ---

# Check instrument output for failures
if grep -q "FAILURES\!\!\!" /tmp/android-instrument-output.txt 2>/dev/null; then
  echo "RESULT: Android integration tests FAILED"
  exit 1
elif grep -q "OK (" /tmp/android-instrument-output.txt 2>/dev/null; then
  echo "RESULT: Android integration tests PASSED"
  exit 0
else
  echo "RESULT: Android integration tests completed with unknown status (exit: $INSTRUMENT_EXIT)"
  exit "$INSTRUMENT_EXIT"
fi
