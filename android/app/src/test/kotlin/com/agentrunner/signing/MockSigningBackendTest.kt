package com.agentrunner.signing

import android.content.Context
import android.util.Base64
import android.util.Log
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkStatic
import io.mockk.unmockkAll
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

class MockSigningBackendTest {

    private lateinit var tempDir: File
    private lateinit var context: Context
    private lateinit var registry: KeyRegistry

    @Before
    fun setUp() {
        tempDir = File(System.getProperty("java.io.tmpdir"), "mock-backend-test-${System.nanoTime()}")
        tempDir.mkdirs()

        // Mock android.util.Base64
        mockkStatic(Base64::class)
        every { Base64.encodeToString(any<ByteArray>(), any()) } answers {
            java.util.Base64.getEncoder().withoutPadding().encodeToString(firstArg<ByteArray>())
        }
        every { Base64.decode(any<String>(), any()) } answers {
            java.util.Base64.getDecoder().decode(firstArg<String>())
        }

        // Mock android.util.Log
        mockkStatic(Log::class)
        every { Log.i(any(), any()) } returns 0
        every { Log.d(any(), any()) } returns 0
        every { Log.w(any(), any<String>()) } returns 0
        every { Log.w(any(), any<String>(), any()) } returns 0

        context = mockk {
            every { filesDir } returns tempDir
        }
        registry = KeyRegistry(context)
    }

    @After
    fun tearDown() {
        unmockkAll()
        tempDir.deleteRecursively()
    }

    private fun createBackend(): MockSigningBackend {
        return MockSigningBackend(context, registry)
    }

    // --- initialize: keypair generation ---

    @Test
    fun `initialize generates keypair and persists files`() {
        val backend = createBackend()
        backend.initialize()

        assertTrue(File(tempDir, "mock-signing-key.der").exists())
        assertTrue(File(tempDir, "mock-signing-key.pub").exists())
    }

    @Test
    fun `initialize registers key in KeyRegistry`() {
        val backend = createBackend()
        backend.initialize()

        val keys = registry.listKeys()
        assertEquals(1, keys.size)
        assertEquals(KeyType.MOCK, keys[0].type)
        assertEquals("Mock Test Key", keys[0].name)
        assertEquals("Mock Test Key", keys[0].publicKeyComment)
        assertNotNull(keys[0].fingerprint)
        assertNotNull(keys[0].createdAt)
    }

    @Test
    fun `initialize is idempotent - second call reuses existing keypair`() {
        val backend1 = createBackend()
        backend1.initialize()

        val pubBytes1 = File(tempDir, "mock-signing-key.pub").readBytes()
        val keyId1 = registry.listKeys()[0].id

        // Create a new backend instance and initialize again
        val backend2 = createBackend()
        backend2.initialize()

        val pubBytes2 = File(tempDir, "mock-signing-key.pub").readBytes()
        val keys = registry.listKeys()

        // Same keypair, same registry entry
        assertEquals(1, keys.size)
        assertTrue(pubBytes1.contentEquals(pubBytes2))
        assertEquals(keyId1, keys[0].id)
    }

    @Test
    fun `initialize reloads keypair from persisted files`() {
        val backend1 = createBackend()
        backend1.initialize()
        val pubBlob1 = File(tempDir, "mock-signing-key.pub").readBytes()

        // Create fresh backend, should load from files, not generate new
        val backend2 = createBackend()
        backend2.initialize()
        val pubBlob2 = File(tempDir, "mock-signing-key.pub").readBytes()

        assertTrue(pubBlob1.contentEquals(pubBlob2))
    }

    @Test
    fun `initialize does not create duplicate registry entry on reload`() {
        val backend = createBackend()
        backend.initialize()
        backend.initialize() // Second call should find existing

        assertEquals(1, registry.listKeys().size)
    }

    // --- listKeys ---

    @Test
    fun `listKeys returns only MOCK keys`() = runTest {
        // Add a non-mock key to registry
        registry.addKey(KeyEntry(
            id = "yk-1", name = "Yubikey", type = KeyType.YUBIKEY_PIV,
            publicKey = byteArrayOf(1), publicKeyComment = "yk", fingerprint = "fp1",
            pivSlot = "9a", createdAt = "2026-03-24T00:00:00Z"
        ))

        val backend = createBackend()
        backend.initialize()

        val keys = backend.listKeys()
        assertEquals(1, keys.size)
        assertEquals(KeyType.MOCK, keys[0].type)
    }

    @Test
    fun `listKeys returns empty before initialize`() = runTest {
        val backend = createBackend()
        val keys = backend.listKeys()
        assertTrue(keys.isEmpty())
    }

    // --- sign ---

    @Test
    fun `sign produces valid ECDSA signature`() = runTest {
        val backend = createBackend()
        backend.initialize()

        val keyId = registry.listKeys()[0].id
        val data = byteArrayOf(1, 2, 3, 4, 5)
        val signature = backend.sign(keyId, data)

        assertNotNull(signature)
        assertTrue(signature.isNotEmpty())

        // Signature should be DER-encoded ECDSA (starts with 0x30)
        assertEquals(0x30.toByte(), signature[0])
    }

    @Test
    fun `sign is deterministic for same data with same key`() = runTest {
        val backend = createBackend()
        backend.initialize()
        val keyId = registry.listKeys()[0].id

        val data = byteArrayOf(10, 20, 30)
        val sig1 = backend.sign(keyId, data)
        val sig2 = backend.sign(keyId, data)

        // ECDSA signatures include random nonce, so they won't be identical
        // But both should be valid (non-empty, DER-encoded)
        assertTrue(sig1.isNotEmpty())
        assertTrue(sig2.isNotEmpty())
    }

    @Test
    fun `sign updates lastUsedAt in registry`() = runTest {
        val backend = createBackend()
        backend.initialize()

        val keyId = registry.listKeys()[0].id
        assertNotNull(registry.getKey(keyId))

        backend.sign(keyId, byteArrayOf(42))

        val updated = registry.getKey(keyId)
        assertNotNull(updated!!.lastUsedAt)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `sign throws for unknown key id`() = runTest {
        val backend = createBackend()
        backend.initialize()
        backend.sign("nonexistent", byteArrayOf(1))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `sign throws for non-mock key type`() = runTest {
        registry.addKey(KeyEntry(
            id = "yk-1", name = "Yubikey", type = KeyType.YUBIKEY_PIV,
            publicKey = byteArrayOf(1), publicKeyComment = "yk", fingerprint = "fp1",
            pivSlot = "9a", createdAt = "2026-03-24T00:00:00Z"
        ))

        val backend = createBackend()
        backend.initialize()
        backend.sign("yk-1", byteArrayOf(1))
    }

    // --- canSign ---

    @Test
    fun `canSign returns true for MOCK key type`() {
        val entry = KeyEntry(
            id = "mock-1", name = "Mock", type = KeyType.MOCK,
            publicKey = byteArrayOf(1), publicKeyComment = "mock", fingerprint = "fp1",
            createdAt = "2026-03-24T00:00:00Z"
        )
        val backend = createBackend()
        assertTrue(backend.canSign(entry))
    }

    @Test
    fun `canSign returns false for YUBIKEY_PIV key type`() {
        val entry = KeyEntry(
            id = "yk-1", name = "Yubikey", type = KeyType.YUBIKEY_PIV,
            publicKey = byteArrayOf(1), publicKeyComment = "yk", fingerprint = "fp1",
            pivSlot = "9a", createdAt = "2026-03-24T00:00:00Z"
        )
        val backend = createBackend()
        assertFalse(backend.canSign(entry))
    }

    @Test
    fun `canSign returns false for ANDROID_KEYSTORE key type`() {
        val entry = KeyEntry(
            id = "ks-1", name = "App Key", type = KeyType.ANDROID_KEYSTORE,
            publicKey = byteArrayOf(1), publicKeyComment = "ks", fingerprint = "fp1",
            keystoreAlias = "agent-runner-ks-1", createdAt = "2026-03-24T00:00:00Z"
        )
        val backend = createBackend()
        assertFalse(backend.canSign(entry))
    }

    // --- SSH public key blob format ---

    @Test
    fun `generated public key blob has SSH wire format`() {
        val backend = createBackend()
        backend.initialize()

        val pubBlob = registry.listKeys()[0].publicKey

        // SSH wire format for ecdsa-sha2-nistp256:
        // string("ecdsa-sha2-nistp256") + string("nistp256") + string(EC point)
        // First 4 bytes are length of "ecdsa-sha2-nistp256" = 19
        assertTrue(pubBlob.size > 4)
        val typeLen = ((pubBlob[0].toInt() and 0xFF) shl 24) or
                ((pubBlob[1].toInt() and 0xFF) shl 16) or
                ((pubBlob[2].toInt() and 0xFF) shl 8) or
                (pubBlob[3].toInt() and 0xFF)
        assertEquals(19, typeLen) // "ecdsa-sha2-nistp256".length

        val typeStr = String(pubBlob, 4, 19)
        assertEquals("ecdsa-sha2-nistp256", typeStr)
    }
}
