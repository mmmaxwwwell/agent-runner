package com.agentrunner

import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.agentrunner.config.ServerConfig
import com.agentrunner.signing.KeyRegistry
import com.agentrunner.signing.KeyType
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.Base64
import java.util.Collections
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * End-to-end integration test for the SSH agent bridge protocol flow.
 *
 * Simulates the complete SSH agent exchange as it occurs during a real `git push`
 * over SSH through the agent-runner bridge:
 *
 * 1. SSH client sends REQUEST_IDENTITIES (type 11) — "what keys do you have?"
 * 2. Android app responds with IDENTITIES_ANSWER (type 12) — MockSigningBackend's key
 * 3. SSH client sends SIGN_REQUEST (type 13) with the discovered key blob — "sign this data"
 * 4. Android app auto-signs via MockSigningBackend, responds with SIGN_RESPONSE (type 14)
 *
 * Uses MockWebServer to simulate the server's bridge relay (the host-side Unix socket →
 * server → WebSocket path is tested by Node.js E2E tests in T018). This test verifies
 * the WebSocket → Android → MockSigningBackend → WebSocket path with full SSH agent
 * binary protocol format validation.
 *
 * Per FR-109: SSH agent bridge end-to-end testing.
 */
@RunWith(AndroidJUnit4::class)
class SshBridgeEndToEndTest {

    companion object {
        private const val TIMEOUT_MS = 15_000L
        private const val POLL_INTERVAL_MS = 300L
        private const val TEST_SESSION_ID = "00000000-0000-0000-0000-e2eb01de0001"
        private const val SIGN_DIALOG_TAG = "sign_request_dialog"

        // SSH agent message type constants
        private const val SSH_AGENTC_REQUEST_IDENTITIES: Byte = 11
        private const val SSH_AGENT_IDENTITIES_ANSWER: Byte = 12
        private const val SSH_AGENTC_SIGN_REQUEST: Byte = 13
        private const val SSH_AGENT_SIGN_RESPONSE: Byte = 14

        private const val MINIMAL_HTML = """
            <html><head><title>Agent Runner</title></head>
            <body><div id="app"><span style="font-weight:bold">Test Project</span></div></body></html>
        """
    }

    private lateinit var mockServer: MockWebServer

    @Before
    fun setUp() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        ServerConfig.save(context, ServerConfig("http://localhost:3000"))
    }

    @After
    fun tearDown() {
        if (::mockServer.isInitialized) {
            try {
                mockServer.shutdown()
            } catch (_: Exception) {}
        }
    }

    /**
     * Full SSH agent bridge protocol: identity listing followed by signing.
     *
     * Simulates the exact sequence a real SSH client performs during `git push`:
     * 1. REQUEST_IDENTITIES → get available keys
     * 2. SIGN_REQUEST with a key from the identity list → get signature
     *
     * Verifies the Android app correctly handles both message types in sequence,
     * MockSigningBackend's key appears in the identity listing, and the sign
     * response contains a valid SSH_AGENT_SIGN_RESPONSE.
     */
    @Test
    fun fullBridgeProtocolSequence_identitiesThenSign() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext

        val receivedMessages = Collections.synchronizedList(mutableListOf<String>())
        val identitiesResponseLatch = CountDownLatch(1)
        val signResponseLatch = CountDownLatch(1)
        var serverWebSocket: WebSocket? = null
        val wsConnectedLatch = CountDownLatch(1)

        mockServer = MockWebServer()
        mockServer.dispatcher = createDispatcher(
            onWsOpen = { ws ->
                serverWebSocket = ws
                wsConnectedLatch.countDown()
            },
            onWsMessage = { _, text ->
                receivedMessages.add(text)
                try {
                    val json = JSONObject(text)
                    if (json.optString("type") == "ssh-agent-response") {
                        val data = Base64.getDecoder().decode(json.getString("data"))
                        when (data[0]) {
                            SSH_AGENT_IDENTITIES_ANSWER -> identitiesResponseLatch.countDown()
                            SSH_AGENT_SIGN_RESPONSE -> signResponseLatch.countDown()
                        }
                    }
                } catch (_: Exception) {}
            }
        )
        mockServer.start()

        val serverUrl = mockServer.url("/").toString().trimEnd('/')
        ServerConfig.save(context, ServerConfig(serverUrl))

        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra(ServerConfigActivity.EXTRA_SERVER_URL, serverUrl)

        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            // Wait for MockSigningBackend to register its key
            val mockKeyBlob = waitForMockKey(context)
            assertNotNull("MockSigningBackend should register a key in KeyRegistry", mockKeyBlob)

            // Navigate to session view — triggers native WebSocket connection
            scenario.onActivity { activity ->
                findWebView(activity)?.loadUrl("$serverUrl/#/sessions/$TEST_SESSION_ID")
            }

            assertTrue(
                "Native WebSocket should connect to mock server",
                wsConnectedLatch.await(TIMEOUT_MS, TimeUnit.MILLISECONDS)
            )
            Thread.sleep(500) // Let WebSocket handler fully wire up

            // --- Step 1: REQUEST_IDENTITIES (type 11) ---
            val identitiesRequestId = UUID.randomUUID().toString()
            val identitiesRequest = JSONObject().apply {
                put("type", "ssh-agent-request")
                put("requestId", identitiesRequestId)
                put("messageType", 11)
                put("context", "List SSH keys for git@github.com:user/repo.git")
                put("data", Base64.getEncoder().encodeToString(byteArrayOf(SSH_AGENTC_REQUEST_IDENTITIES)))
            }
            serverWebSocket!!.send(identitiesRequest.toString())

            assertTrue(
                "Should receive identities response (type 12)",
                identitiesResponseLatch.await(TIMEOUT_MS, TimeUnit.MILLISECONDS)
            )

            // Parse the identity response
            val identitiesResponse = findResponse(receivedMessages, identitiesRequestId)
            assertNotNull("Should find identities response by requestId", identitiesResponse)

            val identitiesJson = JSONObject(identitiesResponse!!)
            val identitiesData = Base64.getDecoder().decode(identitiesJson.getString("data"))

            // Verify SSH_AGENT_IDENTITIES_ANSWER format
            assertEquals(
                "First byte should be SSH_AGENT_IDENTITIES_ANSWER (12)",
                SSH_AGENT_IDENTITIES_ANSWER.toInt(),
                identitiesData[0].toInt()
            )

            // Parse key count (uint32 after type byte)
            val keyCount = ByteBuffer.wrap(identitiesData, 1, 4).int
            assertTrue("Should list at least one key (the mock key)", keyCount >= 1)

            // Extract the first key blob from the response
            val extractedKeyBlob = extractFirstKeyBlob(identitiesData)
            assertNotNull("Should be able to extract key blob from identities response", extractedKeyBlob)

            // Verify the extracted key blob matches MockSigningBackend's key
            assertArrayEquals(
                "Identity response key blob should match MockSigningBackend's registered key",
                mockKeyBlob,
                extractedKeyBlob
            )

            // Verify no dialog was shown for type 11 (identity listing is silent)
            scenario.onActivity { activity ->
                val dialog = activity.supportFragmentManager.findFragmentByTag(SIGN_DIALOG_TAG)
                assertNull("No sign dialog should be shown for identity listing", dialog)
            }

            // --- Step 2: SIGN_REQUEST (type 13) with the discovered key ---
            val signRequestId = UUID.randomUUID().toString()
            val dataToSign = "SSH userauth request data for git push".toByteArray()
            val signRequestData = buildSignRequestData(extractedKeyBlob!!, dataToSign)
            val signRequest = JSONObject().apply {
                put("type", "ssh-agent-request")
                put("requestId", signRequestId)
                put("messageType", 13)
                put("context", "Sign request for git push to git@github.com:user/repo.git")
                put("data", Base64.getEncoder().encodeToString(signRequestData))
            }
            serverWebSocket!!.send(signRequest.toString())

            assertTrue(
                "Should receive sign response (type 14) from MockSigningBackend",
                signResponseLatch.await(TIMEOUT_MS, TimeUnit.MILLISECONDS)
            )

            // Parse and verify the sign response
            val signResponse = findResponse(receivedMessages, signRequestId)
            assertNotNull("Should find sign response by requestId", signResponse)

            val signJson = JSONObject(signResponse!!)
            val signData = Base64.getDecoder().decode(signJson.getString("data"))

            assertEquals(
                "First byte should be SSH_AGENT_SIGN_RESPONSE (14)",
                SSH_AGENT_SIGN_RESPONSE.toInt(),
                signData[0].toInt()
            )

            // Verify the signature blob structure
            verifySignatureBlob(signData)

            // Verify sign dialog is dismissed (MockSigningBackend auto-signs)
            val dialogDismissed = waitForCondition(5_000L) {
                var dismissed = false
                val latch = CountDownLatch(1)
                scenario.onActivity { activity ->
                    val dialog = activity.supportFragmentManager.findFragmentByTag(SIGN_DIALOG_TAG)
                    dismissed = dialog == null || !dialog.isAdded
                    latch.countDown()
                }
                latch.await(2, TimeUnit.SECONDS)
                dismissed
            }
            assertTrue("Sign dialog should be dismissed after auto-signing", dialogDismissed)
        }
    }

    /**
     * Verify that a cancelled sign request returns SSH_AGENT_FAILURE or ssh-agent-cancel.
     *
     * When the sign request contains an unknown key blob (not registered in KeyRegistry),
     * the handler should still process it through the dialog flow. With MockSigningBackend,
     * if the key doesn't match, the cancel path is exercised.
     */
    @Test
    fun signRequestWithUnknownKey_completesWithResponse() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext

        val receivedMessages = Collections.synchronizedList(mutableListOf<String>())
        val responseLatch = CountDownLatch(1)
        var serverWebSocket: WebSocket? = null
        val wsConnectedLatch = CountDownLatch(1)

        mockServer = MockWebServer()
        mockServer.dispatcher = createDispatcher(
            onWsOpen = { ws ->
                serverWebSocket = ws
                wsConnectedLatch.countDown()
            },
            onWsMessage = { _, text ->
                receivedMessages.add(text)
                try {
                    val json = JSONObject(text)
                    val type = json.optString("type")
                    if (type == "ssh-agent-response" || type == "ssh-agent-cancel") {
                        responseLatch.countDown()
                    }
                } catch (_: Exception) {}
            }
        )
        mockServer.start()

        val serverUrl = mockServer.url("/").toString().trimEnd('/')
        ServerConfig.save(context, ServerConfig(serverUrl))

        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra(ServerConfigActivity.EXTRA_SERVER_URL, serverUrl)

        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            waitForMockKey(context) // Ensure backend is initialized

            scenario.onActivity { activity ->
                findWebView(activity)?.loadUrl("$serverUrl/#/sessions/$TEST_SESSION_ID")
            }

            assertTrue(
                "WebSocket should connect",
                wsConnectedLatch.await(TIMEOUT_MS, TimeUnit.MILLISECONDS)
            )
            Thread.sleep(500)

            // Send sign request with a random key blob (not in KeyRegistry)
            val unknownKeyBlob = buildFakeEcdsaKeyBlob()
            val requestId = UUID.randomUUID().toString()
            val signData = buildSignRequestData(unknownKeyBlob, "test data".toByteArray())
            val request = JSONObject().apply {
                put("type", "ssh-agent-request")
                put("requestId", requestId)
                put("messageType", 13)
                put("context", "Sign request for git push to git@github.com:user/repo.git")
                put("data", Base64.getEncoder().encodeToString(signData))
            }
            serverWebSocket!!.send(request.toString())

            // Should receive either a sign response or cancel (depends on handler's key matching)
            assertTrue(
                "Should receive a response or cancel for unknown key request",
                responseLatch.await(TIMEOUT_MS, TimeUnit.MILLISECONDS)
            )

            // Verify we got some response for the request
            val response = receivedMessages.find { msg ->
                try {
                    val json = JSONObject(msg)
                    val rid = json.optString("requestId")
                    rid == requestId
                } catch (_: Exception) { false }
            }
            assertNotNull("Should receive a response matching the requestId", response)
        }
    }

    /**
     * Verify that multiple sequential SSH agent exchanges work correctly.
     *
     * Simulates multiple git push operations in succession: each one does
     * REQUEST_IDENTITIES → SIGN_REQUEST. Verifies the handler correctly
     * processes sequential requests without state leaking between them.
     */
    @Test
    fun multipleSequentialBridgeExchanges() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext

        val receivedMessages = Collections.synchronizedList(mutableListOf<String>())
        var serverWebSocket: WebSocket? = null
        val wsConnectedLatch = CountDownLatch(1)

        mockServer = MockWebServer()
        mockServer.dispatcher = createDispatcher(
            onWsOpen = { ws ->
                serverWebSocket = ws
                wsConnectedLatch.countDown()
            },
            onWsMessage = { _, text -> receivedMessages.add(text) }
        )
        mockServer.start()

        val serverUrl = mockServer.url("/").toString().trimEnd('/')
        ServerConfig.save(context, ServerConfig(serverUrl))

        val intent = Intent(ApplicationProvider.getApplicationContext(), MainActivity::class.java)
            .putExtra(ServerConfigActivity.EXTRA_SERVER_URL, serverUrl)

        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            val mockKeyBlob = waitForMockKey(context)
            assertNotNull("MockSigningBackend should register a key", mockKeyBlob)

            scenario.onActivity { activity ->
                findWebView(activity)?.loadUrl("$serverUrl/#/sessions/$TEST_SESSION_ID")
            }

            assertTrue(
                "WebSocket should connect",
                wsConnectedLatch.await(TIMEOUT_MS, TimeUnit.MILLISECONDS)
            )
            Thread.sleep(500)

            // Run two full SSH agent exchanges sequentially
            for (round in 1..2) {
                val identitiesRequestId = UUID.randomUUID().toString()
                val signRequestId = UUID.randomUUID().toString()

                // Identity request
                serverWebSocket!!.send(JSONObject().apply {
                    put("type", "ssh-agent-request")
                    put("requestId", identitiesRequestId)
                    put("messageType", 11)
                    put("context", "List SSH keys for round $round")
                    put("data", Base64.getEncoder().encodeToString(byteArrayOf(SSH_AGENTC_REQUEST_IDENTITIES)))
                }.toString())

                // Wait for identity response
                val identitiesReceived = waitForCondition(TIMEOUT_MS) {
                    findResponse(receivedMessages, identitiesRequestId) != null
                }
                assertTrue("Round $round: should receive identities response", identitiesReceived)

                // Sign request using the mock key
                val signData = buildSignRequestData(mockKeyBlob!!, "round $round data".toByteArray())
                serverWebSocket!!.send(JSONObject().apply {
                    put("type", "ssh-agent-request")
                    put("requestId", signRequestId)
                    put("messageType", 13)
                    put("context", "Sign request round $round for git push")
                    put("data", Base64.getEncoder().encodeToString(signData))
                }.toString())

                // Wait for sign response
                val signReceived = waitForCondition(TIMEOUT_MS) {
                    findResponse(receivedMessages, signRequestId) != null
                }
                assertTrue("Round $round: should receive sign response", signReceived)

                // Verify sign response is valid
                val signResponse = findResponse(receivedMessages, signRequestId)!!
                val signJson = JSONObject(signResponse)
                val responseData = Base64.getDecoder().decode(signJson.getString("data"))
                assertEquals(
                    "Round $round: first byte should be SSH_AGENT_SIGN_RESPONSE (14)",
                    SSH_AGENT_SIGN_RESPONSE.toInt(),
                    responseData[0].toInt()
                )

                // Small delay between rounds to let handler state reset
                Thread.sleep(500)
            }
        }
    }

    // --- Helper Methods ---

    /**
     * Create a MockWebServer dispatcher that handles WebSocket + HTTP.
     */
    private fun createDispatcher(
        onWsOpen: (WebSocket) -> Unit,
        onWsMessage: (WebSocket, String) -> Unit
    ): Dispatcher = object : Dispatcher() {
        override fun dispatch(request: RecordedRequest): MockResponse {
            val path = request.path ?: ""
            return when {
                path.startsWith("/ws/sessions/") -> {
                    MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                        override fun onOpen(webSocket: WebSocket, response: Response) {
                            onWsOpen(webSocket)
                        }
                        override fun onMessage(webSocket: WebSocket, text: String) {
                            onWsMessage(webSocket, text)
                        }
                    })
                }
                path == "/api/health" -> MockResponse()
                    .setHeader("Content-Type", "application/json")
                    .setBody("""{"status":"ok","uptime":1,"sandboxAvailable":false,"cloudSttAvailable":false}""")
                path == "/api/projects" -> MockResponse()
                    .setHeader("Content-Type", "application/json")
                    .setBody("""{"registered":[],"discovered":[],"discoveryError":null}""")
                else -> MockResponse()
                    .setHeader("Content-Type", "text/html")
                    .setBody(MINIMAL_HTML)
            }
        }
    }

    /**
     * Build SSH agent sign request data.
     * Format: type(13) + string(key_blob) + string(data) + uint32(flags)
     * where string = uint32(length) + bytes
     */
    private fun buildSignRequestData(keyBlob: ByteArray, data: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(SSH_AGENTC_SIGN_REQUEST.toInt())
        writeSshString(out, keyBlob)
        writeSshString(out, data)
        out.write(ByteBuffer.allocate(4).putInt(0).array()) // flags = 0
        return out.toByteArray()
    }

    /**
     * Build a fake ECDSA P-256 SSH public key blob (for unknown key tests).
     * Format: string("ecdsa-sha2-nistp256") + string("nistp256") + string(0x04 + 32-byte X + 32-byte Y)
     */
    private fun buildFakeEcdsaKeyBlob(): ByteArray {
        val out = ByteArrayOutputStream()
        writeSshString(out, "ecdsa-sha2-nistp256".toByteArray())
        writeSshString(out, "nistp256".toByteArray())
        // Fake uncompressed EC point: 0x04 + 32 random X + 32 random Y
        val fakePoint = ByteArray(65)
        fakePoint[0] = 0x04
        for (i in 1 until 65) fakePoint[i] = (i % 256).toByte()
        writeSshString(out, fakePoint)
        return out.toByteArray()
    }

    private fun writeSshString(out: ByteArrayOutputStream, data: ByteArray) {
        out.write(ByteBuffer.allocate(4).putInt(data.size).array())
        out.write(data)
    }

    /**
     * Extract the first key blob from an SSH_AGENT_IDENTITIES_ANSWER response.
     * Format: byte(12) + uint32(nkeys) + [uint32(blob_len) + blob + uint32(comment_len) + comment] * nkeys
     */
    private fun extractFirstKeyBlob(data: ByteArray): ByteArray? {
        if (data.size < 9) return null // type(1) + count(4) + blob_len(4) minimum
        val buf = ByteBuffer.wrap(data)
        buf.get() // skip type byte (12)
        val nkeys = buf.int
        if (nkeys < 1) return null
        val blobLen = buf.int
        if (blobLen <= 0 || blobLen > data.size - buf.position()) return null
        val blob = ByteArray(blobLen)
        buf.get(blob)
        return blob
    }

    /**
     * Verify the SSH_AGENT_SIGN_RESPONSE structure.
     * Format: byte(14) + string(signature_blob)
     * where signature_blob = string("ecdsa-sha2-nistp256") + string(der_signature)
     */
    private fun verifySignatureBlob(data: ByteArray) {
        assertTrue("Sign response must be at least 10 bytes", data.size >= 10)
        assertEquals("Type byte should be 14", SSH_AGENT_SIGN_RESPONSE.toInt(), data[0].toInt())

        val buf = ByteBuffer.wrap(data, 1, data.size - 1)

        // Outer signature blob: uint32(len) + blob
        val outerLen = buf.int
        assertTrue("Outer signature blob length should be positive", outerLen > 0)
        assertTrue(
            "Outer signature blob length should fit in response",
            outerLen <= data.size - 5
        )

        // Inner: string("ecdsa-sha2-nistp256") + string(der_signature)
        val algoLen = buf.int
        assertTrue("Algorithm name length should be 19 (ecdsa-sha2-nistp256)", algoLen == 19)
        val algoBytes = ByteArray(algoLen)
        buf.get(algoBytes)
        assertEquals(
            "Algorithm should be ecdsa-sha2-nistp256",
            "ecdsa-sha2-nistp256",
            String(algoBytes)
        )

        // DER signature
        val sigLen = buf.int
        assertTrue("DER signature length should be positive", sigLen > 0)
        val sigBytes = ByteArray(sigLen)
        buf.get(sigBytes)
        // DER-encoded ECDSA signatures start with 0x30 (SEQUENCE tag)
        assertEquals(
            "DER signature should start with SEQUENCE tag (0x30)",
            0x30,
            sigBytes[0].toInt() and 0xFF
        )
    }

    /**
     * Find an ssh-agent-response message matching a specific requestId.
     */
    private fun findResponse(messages: List<String>, requestId: String): String? {
        return messages.find { msg ->
            try {
                val json = JSONObject(msg)
                json.optString("type") == "ssh-agent-response" &&
                    json.optString("requestId") == requestId
            } catch (_: Exception) { false }
        }
    }

    /**
     * Wait for MockSigningBackend to register its key in KeyRegistry.
     * Returns the mock key's public key blob, or null on timeout.
     */
    private fun waitForMockKey(context: android.content.Context): ByteArray? {
        val registry = KeyRegistry(context)
        val deadline = System.currentTimeMillis() + TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            try {
                val keys = registry.listKeys()
                val mockKey = keys.find { it.type == KeyType.MOCK }
                if (mockKey != null) return mockKey.publicKey
            } catch (_: Exception) {}
            Thread.sleep(POLL_INTERVAL_MS)
        }
        return null
    }

    private fun findWebView(activity: MainActivity): WebView? {
        return findViewOfType(activity.window.decorView, WebView::class.java)
    }

    @Suppress("UNCHECKED_CAST")
    private fun <T> findViewOfType(view: View, clazz: Class<T>): T? {
        if (clazz.isInstance(view)) return view as T
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                val found = findViewOfType(view.getChildAt(i), clazz)
                if (found != null) return found
            }
        }
        return null
    }

    private fun waitForCondition(timeoutMs: Long, condition: () -> Boolean): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            try {
                if (condition()) return true
            } catch (_: Exception) {}
            Thread.sleep(POLL_INTERVAL_MS)
        }
        return false
    }
}
