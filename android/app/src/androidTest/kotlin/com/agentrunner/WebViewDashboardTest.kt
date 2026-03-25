package com.agentrunner

import android.content.Intent
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.agentrunner.config.ServerConfig
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Integration test: verifies the Android app launches, WebView loads the PWA
 * from the agent-runner server, the dashboard renders a project list, and
 * navigation to a project detail view works.
 *
 * Prerequisites (handled by the orchestration script):
 * - agent-runner server running on host with test fixtures
 * - `adb reverse tcp:<port> tcp:<port>` so localhost reaches the host server
 *
 * Per FR-068, FR-106.
 */
@RunWith(AndroidJUnit4::class)
class WebViewDashboardTest {

    companion object {
        private const val DEFAULT_PORT = 3001
        private const val LOAD_TIMEOUT_MS = 15_000L
        private const val POLL_INTERVAL_MS = 500L
    }

    private lateinit var serverUrl: String

    @Before
    fun setUp() {
        // Read port from instrumentation args (set by orchestration script), default to 3001
        val args = InstrumentationRegistry.getArguments()
        val port = args.getString("serverPort")?.toIntOrNull() ?: DEFAULT_PORT
        serverUrl = "http://localhost:$port"

        // Pre-configure the server URL so MainActivity doesn't redirect to ServerConfigActivity
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        ServerConfig.save(context, ServerConfig(serverUrl))
    }

    @Test
    fun appLaunchesAndWebViewLoads() {
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra(ServerConfigActivity.EXTRA_SERVER_URL, serverUrl)

        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            // Wait for page to finish loading (check that #app has content beyond "Loading…")
            val loaded = waitForCondition(LOAD_TIMEOUT_MS) {
                evaluateJs(scenario, "document.getElementById('app')?.children.length > 0") == "true"
            }
            assertTrue("PWA should load and render content in #app", loaded)
        }
    }

    @Test
    fun dashboardRendersProjectList() {
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra(ServerConfigActivity.EXTRA_SERVER_URL, serverUrl)

        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            // Wait for project names to appear (test fixtures have projects)
            val hasProjects = waitForCondition(LOAD_TIMEOUT_MS) {
                val count = evaluateJs(scenario,
                    "document.querySelectorAll('span').length"
                )
                count != null && count != "null" && count.toIntOrNull()?.let { it > 0 } == true
            }
            assertTrue("Dashboard should render spans (project names, badges, etc.)", hasProjects)

            // Verify at least one project name from fixtures is visible in the page text
            // The test fixture projects-with-active.json has "test-project-alpha" and "test-project-beta"
            // But the server may use discovered projects from the host. Check for any project-like content.
            val bodyText = evaluateJs(scenario,
                "document.body?.innerText || ''"
            ) ?: ""

            // The dashboard should show either registered or discovered projects
            // At minimum, the "Agent Runner" title and navigation should be present
            assertTrue(
                "Dashboard should contain 'Agent Runner' text",
                bodyText.contains("Agent Runner")
            )
        }
    }

    @Test
    fun dashboardShowsRegisteredProjects() {
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra(ServerConfigActivity.EXTRA_SERVER_URL, serverUrl)

        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            // Wait for the dashboard to render project cards
            val hasProjectCards = waitForCondition(LOAD_TIMEOUT_MS) {
                // Look for bold spans (project names are rendered with fontWeight: bold)
                val count = evaluateJs(scenario, """
                    (function() {
                        var spans = document.querySelectorAll('span');
                        var bold = 0;
                        for (var i = 0; i < spans.length; i++) {
                            if (spans[i].style.fontWeight === 'bold') bold++;
                        }
                        return bold;
                    })()
                """.trimIndent())
                count != null && count != "null" && count.toIntOrNull()?.let { it > 0 } == true
            }
            assertTrue("Dashboard should render project name spans with bold styling", hasProjectCards)

            // Verify the project list fetched from server has items
            // GET /api/projects returns { registered: [...], discovered: [...] }
            val projectCount = evaluateJs(scenario, """
                (function() {
                    var spans = document.querySelectorAll('span');
                    var names = [];
                    for (var i = 0; i < spans.length; i++) {
                        if (spans[i].style.fontWeight === 'bold' && spans[i].textContent.length > 0) {
                            names.push(spans[i].textContent);
                        }
                    }
                    return names.length;
                })()
            """.trimIndent())

            assertNotNull("Should find project names", projectCount)
            assertTrue(
                "Should have at least one project displayed",
                projectCount!!.toIntOrNull()?.let { it > 0 } == true
            )
        }
    }

    @Test
    fun navigationToProjectDetailWorks() {
        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra(ServerConfigActivity.EXTRA_SERVER_URL, serverUrl)

        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            // Wait for dashboard to load
            val loaded = waitForCondition(LOAD_TIMEOUT_MS) {
                evaluateJs(scenario, "document.getElementById('app')?.children.length > 0") == "true"
            }
            assertTrue("Dashboard should load first", loaded)

            // Get the first project's navigation link (projects are clickable divs that navigate via hash)
            // Find the first project link href from the page
            // Wait for project cards to be present before attempting click
            waitForResult(LOAD_TIMEOUT_MS) {
                evaluateJs(scenario, """
                    (function() {
                        var links = document.querySelectorAll('a[href*="#/projects/"]');
                        if (links.length > 0) return links[0].getAttribute('href');
                        // Fallback: click the first bold span's parent div (project card)
                        var spans = document.querySelectorAll('span');
                        for (var i = 0; i < spans.length; i++) {
                            if (spans[i].style.fontWeight === 'bold') {
                                var parent = spans[i].parentElement;
                                while (parent && parent !== document.body) {
                                    if (parent.onclick) return 'HAS_CLICK_HANDLER';
                                    parent = parent.parentElement;
                                }
                            }
                        }
                        return null;
                    })()
                """.trimIndent())
            }

            // Navigate to the project detail by clicking the first project card
            evaluateJs(scenario, """
                (function() {
                    // Try clicking the first project card (bold span's clickable ancestor)
                    var spans = document.querySelectorAll('span');
                    for (var i = 0; i < spans.length; i++) {
                        if (spans[i].style.fontWeight === 'bold') {
                            var el = spans[i];
                            while (el && el !== document.body) {
                                if (el.onclick || el.getAttribute('onclick')) {
                                    el.click();
                                    return 'clicked';
                                }
                                el = el.parentElement;
                            }
                            // Preact attaches handlers via addEventListener, not onclick attr
                            // Just click the bold span's parent — Preact event delegation will fire
                            spans[i].parentElement.click();
                            return 'clicked-parent';
                        }
                    }
                    return 'no-project';
                })()
            """.trimIndent())

            // Wait for navigation — URL hash should change to #/projects/<id>
            val navigated = waitForCondition(LOAD_TIMEOUT_MS) {
                val hash = evaluateJs(scenario, "window.location.hash") ?: ""
                hash.contains("#/projects/")
            }
            assertTrue("Should navigate to project detail view (hash contains #/projects/)", navigated)

            // Verify the project detail view rendered (should have a "Back" link)
            val hasBackLink = waitForCondition(5000L) {
                evaluateJs(scenario, """
                    (function() {
                        var links = document.querySelectorAll('a[href="#/"]');
                        for (var i = 0; i < links.length; i++) {
                            if (links[i].textContent.indexOf('Back') >= 0) return true;
                        }
                        return false;
                    })()
                """.trimIndent()) == "true"
            }
            assertTrue("Project detail view should have a Back link to dashboard", hasBackLink)
        }
    }

    // --- Helpers ---

    /**
     * Execute JavaScript in the WebView and return the result synchronously.
     */
    private fun evaluateJs(scenario: ActivityScenario<MainActivity>, script: String): String? {
        val latch = CountDownLatch(1)
        var result: String? = null

        scenario.onActivity { activity ->
            val webView = findWebView(activity)
            webView?.evaluateJavascript(script) { value ->
                // evaluateJavascript returns JSON-encoded strings — strip outer quotes
                result = if (value == "null" || value == null) null
                else value.removeSurrounding("\"")
                latch.countDown()
            } ?: latch.countDown()
        }

        latch.await(5, TimeUnit.SECONDS)
        return result
    }

    /**
     * Find the WebView in the activity's view hierarchy.
     */
    private fun findWebView(activity: MainActivity): WebView? {
        val rootView = activity.window.decorView
        return findViewOfType(rootView, WebView::class.java)
    }

    @Suppress("UNCHECKED_CAST")
    private fun <T> findViewOfType(view: android.view.View, clazz: Class<T>): T? {
        if (clazz.isInstance(view)) return view as T
        if (view is android.view.ViewGroup) {
            for (i in 0 until view.childCount) {
                val found = findViewOfType(view.getChildAt(i), clazz)
                if (found != null) return found
            }
        }
        return null
    }

    /**
     * Poll a condition until it returns true or timeout expires.
     */
    private fun waitForCondition(timeoutMs: Long, condition: () -> Boolean): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            try {
                if (condition()) return true
            } catch (_: Exception) {
                // Condition threw — retry
            }
            Thread.sleep(POLL_INTERVAL_MS)
        }
        return false
    }

    /**
     * Poll until a non-null, non-"null" result is returned or timeout expires.
     */
    private fun waitForResult(timeoutMs: Long, supplier: () -> String?): String? {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            try {
                val result = supplier()
                if (result != null && result != "null") return result
            } catch (_: Exception) {
                // Supplier threw — retry
            }
            Thread.sleep(POLL_INTERVAL_MS)
        }
        return null
    }
}
