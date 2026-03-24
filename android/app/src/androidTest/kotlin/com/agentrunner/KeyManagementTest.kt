package com.agentrunner

import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.action.ViewActions.replaceText
import androidx.test.espresso.matcher.ViewMatchers.withClassName
import androidx.test.espresso.matcher.ViewMatchers.withText
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.agentrunner.signing.KeyEntry
import com.agentrunner.signing.KeyRegistry
import com.agentrunner.signing.KeyType
import com.google.android.material.button.MaterialButton
import org.hamcrest.Matchers.endsWith
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Integration test: verifies the KeyManagementActivity UI flow.
 *
 * Tests:
 * - Opening key management screen shows empty state
 * - Generating an app key (Android Keystore) via dialog
 * - Verifying key appears in list with correct details (name, type, fingerprint)
 * - Exporting public key to clipboard
 * - Removing a key and verifying it disappears
 *
 * Per FR-099.
 */
@RunWith(AndroidJUnit4::class)
class KeyManagementTest {

    companion object {
        private const val TIMEOUT_MS = 10_000L
        private const val POLL_INTERVAL_MS = 300L
        private const val TEST_KEY_NAME = "Test App Key"
    }

    private lateinit var registry: KeyRegistry

    @Before
    fun setUp() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        registry = KeyRegistry(context)
        // Clear any existing keys to start fresh
        clearAllKeys(context)
    }

    @After
    fun tearDown() {
        try {
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            clearAllKeys(context)
        } catch (_: Exception) {}
    }

    private fun clearAllKeys(context: Context) {
        val reg = KeyRegistry(context)
        for (key in reg.listKeys()) {
            // Delete from Android Keystore if applicable
            if (key.type == KeyType.ANDROID_KEYSTORE && key.keystoreAlias != null) {
                try {
                    val ks = java.security.KeyStore.getInstance("AndroidKeyStore")
                    ks.load(null)
                    if (ks.containsAlias(key.keystoreAlias!!)) {
                        ks.deleteEntry(key.keystoreAlias!!)
                    }
                } catch (_: Exception) {}
            }
            reg.removeKey(key.id)
        }
    }

    @Test
    fun keyManagementShowsEmptyState() {
        val intent = Intent(ApplicationProvider.getApplicationContext(), KeyManagementActivity::class.java)
        ActivityScenario.launch<KeyManagementActivity>(intent).use { scenario ->
            val latch = CountDownLatch(1)
            var emptyStateVisible = false
            var keyListVisible = false

            scenario.onActivity { activity ->
                val emptyState = activity.findViewById<TextView>(R.id.emptyState)
                val keyList = activity.findViewById<RecyclerView>(R.id.keyList)
                emptyStateVisible = emptyState.visibility == View.VISIBLE
                keyListVisible = keyList.visibility == View.VISIBLE
                latch.countDown()
            }
            latch.await(5, TimeUnit.SECONDS)

            assertTrue("Empty state should be visible when no keys exist", emptyStateVisible)
            assertFalse("Key list should be hidden when no keys exist", keyListVisible)
        }
    }

    @Test
    fun generateAppKeyAddsKeyToList() {
        val intent = Intent(ApplicationProvider.getApplicationContext(), KeyManagementActivity::class.java)
        ActivityScenario.launch<KeyManagementActivity>(intent).use { scenario ->
            // Click the "Generate App Key" button
            onView(withId(R.id.generateAppKeyButton)).perform(click())

            // Type the key name in the dialog's EditText
            onView(withClassName(endsWith("EditText"))).perform(replaceText(TEST_KEY_NAME))

            // Click the positive button (Generate)
            onView(withText(R.string.key_mgmt_generate)).perform(click())

            // Wait for key generation to complete and appear in registry
            val keyAppeared = waitForCondition(TIMEOUT_MS) {
                registry.listKeys().any { it.name == TEST_KEY_NAME && it.type == KeyType.ANDROID_KEYSTORE }
            }
            assertTrue("App key should be registered in KeyRegistry", keyAppeared)

            // Verify the key appears in the RecyclerView
            val keyVisible = waitForCondition(TIMEOUT_MS) {
                var visible = false
                val latch = CountDownLatch(1)
                scenario.onActivity { activity ->
                    val keyList = activity.findViewById<RecyclerView>(R.id.keyList)
                    visible = keyList.visibility == View.VISIBLE && keyList.adapter?.itemCount?.let { it > 0 } == true
                    latch.countDown()
                }
                latch.await(2, TimeUnit.SECONDS)
                visible
            }
            assertTrue("Key should appear in the RecyclerView", keyVisible)

            // Verify key card shows correct details
            val latch = CountDownLatch(1)
            var nameText: String? = null
            var typeText: String? = null
            var fingerprintText: String? = null

            scenario.onActivity { activity ->
                val keyList = activity.findViewById<RecyclerView>(R.id.keyList)
                val viewHolder = keyList.findViewHolderForAdapterPosition(0)
                if (viewHolder != null) {
                    nameText = viewHolder.itemView.findViewById<TextView>(R.id.keyName)?.text?.toString()
                    typeText = viewHolder.itemView.findViewById<TextView>(R.id.keyType)?.text?.toString()
                    fingerprintText = viewHolder.itemView.findViewById<TextView>(R.id.keyFingerprint)?.text?.toString()
                }
                latch.countDown()
            }
            latch.await(5, TimeUnit.SECONDS)

            assertEquals("Key name should match", TEST_KEY_NAME, nameText)
            assertEquals("Key type should be 'App Key'", "App Key", typeText)
            assertNotNull("Fingerprint should be displayed", fingerprintText)
            assertTrue("Fingerprint should be non-empty", fingerprintText!!.isNotEmpty())

            // Verify empty state is hidden
            val emptyHidden = waitForCondition(5_000L) {
                var hidden = false
                val l = CountDownLatch(1)
                scenario.onActivity { activity ->
                    hidden = activity.findViewById<TextView>(R.id.emptyState).visibility == View.GONE
                    l.countDown()
                }
                l.await(2, TimeUnit.SECONDS)
                hidden
            }
            assertTrue("Empty state should be hidden when keys exist", emptyHidden)
        }
    }

    @Test
    fun exportKeyCopiesToClipboard() {
        // Pre-generate a key directly via Keystore APIs (no biometric)
        val preKey = generateTestKey("Export Test Key")
        assertNotNull("Pre-generated key should exist", preKey)

        val intent = Intent(ApplicationProvider.getApplicationContext(), KeyManagementActivity::class.java)
        ActivityScenario.launch<KeyManagementActivity>(intent).use { scenario ->
            // Wait for the key to appear in the list
            val keyVisible = waitForCondition(TIMEOUT_MS) {
                var visible = false
                val latch = CountDownLatch(1)
                scenario.onActivity { activity ->
                    val keyList = activity.findViewById<RecyclerView>(R.id.keyList)
                    visible = keyList.adapter?.itemCount?.let { it > 0 } == true
                    latch.countDown()
                }
                latch.await(2, TimeUnit.SECONDS)
                visible
            }
            assertTrue("Key should appear in list", keyVisible)

            // Click the Export button on the first key card
            scenario.onActivity { activity ->
                val keyList = activity.findViewById<RecyclerView>(R.id.keyList)
                val viewHolder = keyList.findViewHolderForAdapterPosition(0)
                viewHolder?.itemView?.findViewById<MaterialButton>(R.id.exportButton)?.performClick()
            }

            // Verify clipboard contains the SSH public key
            Thread.sleep(500)
            val latch = CountDownLatch(1)
            var clipText: String? = null
            scenario.onActivity { activity ->
                val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipText = clipboard.primaryClip?.getItemAt(0)?.text?.toString()
                latch.countDown()
            }
            latch.await(5, TimeUnit.SECONDS)

            assertNotNull("Clipboard should contain text", clipText)
            assertTrue(
                "Clipboard should contain SSH public key starting with ecdsa-sha2-nistp256",
                clipText!!.startsWith("ecdsa-sha2-nistp256 ")
            )
        }
    }

    @Test
    fun removeKeyRemovesFromList() {
        // Pre-generate a key
        val preKey = generateTestKey("Remove Test Key")
        assertNotNull("Pre-generated key should exist", preKey)

        val intent = Intent(ApplicationProvider.getApplicationContext(), KeyManagementActivity::class.java)
        ActivityScenario.launch<KeyManagementActivity>(intent).use { scenario ->
            // Wait for the key to appear
            val keyVisible = waitForCondition(TIMEOUT_MS) {
                var visible = false
                val latch = CountDownLatch(1)
                scenario.onActivity { activity ->
                    val keyList = activity.findViewById<RecyclerView>(R.id.keyList)
                    visible = keyList.adapter?.itemCount?.let { it > 0 } == true
                    latch.countDown()
                }
                latch.await(2, TimeUnit.SECONDS)
                visible
            }
            assertTrue("Key should appear in list before removal", keyVisible)

            // Click the Remove button on the first key card
            scenario.onActivity { activity ->
                val keyList = activity.findViewById<RecyclerView>(R.id.keyList)
                val viewHolder = keyList.findViewHolderForAdapterPosition(0)
                viewHolder?.itemView?.findViewById<MaterialButton>(R.id.removeButton)?.performClick()
            }

            // Wait for confirmation dialog, then confirm removal
            Thread.sleep(500)
            onView(withText(R.string.key_mgmt_remove)).perform(click())

            // Wait for key to be removed from registry
            val keyRemoved = waitForCondition(TIMEOUT_MS) {
                registry.listKeys().isEmpty()
            }
            assertTrue("Key should be removed from KeyRegistry", keyRemoved)

            // Verify empty state is shown again
            val emptyVisible = waitForCondition(5_000L) {
                var visible = false
                val latch = CountDownLatch(1)
                scenario.onActivity { activity ->
                    visible = activity.findViewById<TextView>(R.id.emptyState).visibility == View.VISIBLE
                    latch.countDown()
                }
                latch.await(2, TimeUnit.SECONDS)
                visible
            }
            assertTrue("Empty state should be visible after removing all keys", emptyVisible)
        }
    }

    // --- Helpers ---

    /**
     * Generate a test ECDSA P-256 key in Android Keystore without biometric requirement
     * and register it in KeyRegistry.
     */
    private fun generateTestKey(name: String): KeyEntry? {
        return try {
            val keyId = java.util.UUID.randomUUID().toString()
            val alias = "agent-runner-$keyId"

            val spec = android.security.keystore.KeyGenParameterSpec.Builder(
                alias,
                android.security.keystore.KeyProperties.PURPOSE_SIGN
            )
                .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
                .setDigests(android.security.keystore.KeyProperties.DIGEST_SHA256)
                .build()

            val kpg = java.security.KeyPairGenerator.getInstance(
                android.security.keystore.KeyProperties.KEY_ALGORITHM_EC,
                "AndroidKeyStore"
            )
            kpg.initialize(spec)
            kpg.generateKeyPair()

            val keyStore = java.security.KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            val cert = keyStore.getCertificate(alias) as java.security.cert.X509Certificate
            val publicKeyBlob = com.agentrunner.yubikey.SshKeyFormatter.toSshPublicKeyBlob(cert)
            val fingerprint = KeyRegistry.computeFingerprint(publicKeyBlob)

            val entry = KeyEntry(
                id = keyId,
                name = name,
                type = KeyType.ANDROID_KEYSTORE,
                publicKey = publicKeyBlob,
                publicKeyComment = "Android Keystore ($name)",
                fingerprint = fingerprint,
                keystoreAlias = alias,
                createdAt = java.time.Instant.now().toString()
            )
            registry.addKey(entry)
            entry
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Helper to find a view by resource ID (Espresso-compatible).
     */
    private fun withId(id: Int): org.hamcrest.Matcher<View> {
        return androidx.test.espresso.matcher.ViewMatchers.withId(id)
    }

    /**
     * Poll a condition until it returns true or timeout expires.
     */
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
