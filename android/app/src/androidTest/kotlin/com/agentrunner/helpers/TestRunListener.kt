package com.agentrunner.helpers

import android.os.Environment
import android.util.Log
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.runner.Description
import org.junit.runner.Result
import org.junit.runner.notification.Failure
import org.junit.runner.notification.RunListener
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Custom JUnit RunListener that writes structured test results to device storage.
 *
 * Output format matches the Node.js test reporter (FR-111–FR-115):
 * - summary.json: pass/fail counts + list of failed test names
 * - failures/<test-name>.log: assertion details, stack trace, logcat per failure
 * - Screenshots captured on UI test failures (via UiAutomator)
 *
 * Results are written to the app's external files directory under
 * test-logs/android-integration/<timestamp>/ so they can be pulled via adb.
 */
class TestRunListener : RunListener() {

    companion object {
        private const val TAG = "TestRunListener"
    }

    private data class PassedTest(
        val name: String,
        val className: String,
        val durationMs: Long
    )

    private data class FailedTest(
        val name: String,
        val className: String,
        val durationMs: Long,
        val failure: Failure
    )

    private val passed = mutableListOf<PassedTest>()
    private val failed = mutableListOf<FailedTest>()
    private val ignored = mutableListOf<String>()
    private var testStartTime = 0L
    private var currentTest: Description? = null

    private lateinit var outDir: File
    private lateinit var failuresDir: File
    private lateinit var screenshotsDir: File

    override fun testRunStarted(description: Description) {
        val timestamp = SimpleDateFormat("yyyy-MM-dd'T'HH-mm-ss", Locale.US).format(Date())
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val baseDir = context.getExternalFilesDir(null)
            ?: context.filesDir
        outDir = File(baseDir, "test-logs/android-integration/$timestamp")
        failuresDir = File(outDir, "failures")
        screenshotsDir = File(outDir, "screenshots")
        outDir.mkdirs()
        failuresDir.mkdirs()
        screenshotsDir.mkdirs()
        Log.i(TAG, "Test results will be written to: ${outDir.absolutePath}")
    }

    override fun testStarted(description: Description) {
        currentTest = description
        testStartTime = System.currentTimeMillis()
        Log.i(TAG, "▶ ${description.displayName}")
    }

    override fun testFinished(description: Description) {
        val duration = System.currentTimeMillis() - testStartTime
        // Only record as passed if not already recorded as failed or ignored
        val fullName = description.displayName
        if (failed.none { it.name == fullName } && fullName !in ignored) {
            passed.add(PassedTest(
                name = fullName,
                className = description.className,
                durationMs = duration
            ))
            Log.i(TAG, "  ✓ $fullName (${duration}ms)")
        }
        currentTest = null
    }

    override fun testFailure(failure: Failure) {
        val duration = System.currentTimeMillis() - testStartTime
        val name = failure.description.displayName
        failed.add(FailedTest(
            name = name,
            className = failure.description.className,
            durationMs = duration,
            failure = failure
        ))
        Log.e(TAG, "  ✗ $name (${duration}ms)")
        Log.e(TAG, "    ${failure.message}")

        // Capture screenshot on UI test failure
        captureScreenshot(failure.description)

        // Capture filtered logcat
        captureLogcat(failure.description)
    }

    override fun testIgnored(description: Description) {
        ignored.add(description.displayName)
        Log.i(TAG, "  ⊘ ${description.displayName} (ignored)")
    }

    override fun testRunFinished(result: Result) {
        writeSummaryJson(result)
        writeFailureDetails()
        Log.i(TAG, "─── Summary ───")
        Log.i(TAG, "Total: ${result.runCount} | Passed: ${passed.size} | Failed: ${failed.size} | Ignored: ${ignored.size}")
        Log.i(TAG, "Duration: ${result.runTime}ms")
        Log.i(TAG, "Results: ${outDir.absolutePath}")
    }

    private fun writeSummaryJson(result: Result) {
        val summary = JSONObject().apply {
            put("type", "android-integration")
            put("timestamp", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US).format(Date()))
            put("total", result.runCount)
            put("passed", passed.size)
            put("failed", failed.size)
            put("ignored", ignored.size)
            put("duration_ms", result.runTime)
            put("failedTests", JSONArray(failed.map { it.name }))
        }
        File(outDir, "summary.json").writeText(summary.toString(2) + "\n")
    }

    private fun writeFailureDetails() {
        for (f in failed) {
            val filename = sanitizeFilename(f.name) + ".log"
            val lines = buildString {
                appendLine("Test: ${f.name}")
                appendLine("Class: ${f.className}")
                appendLine("Duration: ${f.durationMs}ms")
                appendLine()
                appendLine("--- Assertion Details ---")
                appendLine("Message: ${f.failure.message ?: "none"}")
                appendLine("Exception: ${f.failure.exception?.javaClass?.name ?: "none"}")
                appendLine()
                appendLine("--- Stack Trace ---")
                appendLine(f.failure.trace ?: "no stack trace")
                appendLine()
                appendLine("--- Logcat (filtered) ---")
                val logcatFile = File(failuresDir, sanitizeFilename(f.name) + ".logcat")
                if (logcatFile.exists()) {
                    appendLine(logcatFile.readText())
                } else {
                    appendLine("(no logcat captured)")
                }
            }
            File(failuresDir, filename).writeText(lines)
        }
    }

    private fun captureScreenshot(description: Description) {
        try {
            val filename = sanitizeFilename(description.displayName) + ".png"
            val screenshotFile = File(screenshotsDir, filename)

            // Use UiAutomator's takeScreenshot via instrumentation shell
            val process = Runtime.getRuntime().exec(arrayOf(
                "screencap", "-p", screenshotFile.absolutePath
            ))
            val exitCode = process.waitFor()
            if (exitCode == 0 && screenshotFile.exists()) {
                Log.i(TAG, "    Screenshot saved: ${screenshotFile.name}")
            } else {
                Log.w(TAG, "    Screenshot capture failed (exit code: $exitCode)")
            }
        } catch (e: Exception) {
            Log.w(TAG, "    Screenshot capture failed: ${e.message}")
        }
    }

    private fun captureLogcat(description: Description) {
        try {
            val filename = sanitizeFilename(description.displayName) + ".logcat"
            val logcatFile = File(failuresDir, filename)

            // Capture last 200 lines of logcat, filtered to our app's PID
            val pid = android.os.Process.myPid()
            val process = Runtime.getRuntime().exec(arrayOf(
                "logcat", "-d", "-t", "200", "--pid=$pid"
            ))
            val reader = BufferedReader(InputStreamReader(process.inputStream))
            val output = reader.readText()
            reader.close()
            process.waitFor()

            logcatFile.writeText(output)
            Log.i(TAG, "    Logcat saved: ${logcatFile.name}")
        } catch (e: Exception) {
            Log.w(TAG, "    Logcat capture failed: ${e.message}")
        }
    }

    private fun sanitizeFilename(name: String): String {
        return name
            .replace(Regex("[^a-zA-Z0-9_.-]"), "_")
            .replace(Regex("_+"), "_")
            .replace(Regex("^_|_$"), "")
            .take(200)
    }
}
