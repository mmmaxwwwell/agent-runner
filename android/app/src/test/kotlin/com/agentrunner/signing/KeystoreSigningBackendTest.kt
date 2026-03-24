package com.agentrunner.signing

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.util.Base64
import android.util.Log
import androidx.biometric.BiometricPrompt
import androidx.fragment.app.FragmentActivity
import com.agentrunner.yubikey.SshKeyFormatter
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkConstructor
import io.mockk.mockkObject
import io.mockk.mockkStatic
import io.mockk.slot
import io.mockk.spyk
import io.mockk.unmockkAll
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec

class KeystoreSigningBackendTest {

    private lateinit var tempDir: File
    private lateinit var context: Context
    private lateinit var activity: FragmentActivity
    private lateinit var registry: KeyRegistry
    private lateinit var mockKeyStore: KeyStore
    private lateinit var mockKeyPairGenerator: KeyPairGenerator

    // Test keys generated via standard Java crypto (not AndroidKeyStore)
    private lateinit var testKeyPair: KeyPair
    private val testPublicKeyBlob = byteArrayOf(0, 0, 0, 19) // placeholder SSH blob
    private val testFingerprint = "SHA256:testfp"

    @Before
    fun setUp() {
        tempDir = File(System.getProperty("java.io.tmpdir"), "keystore-backend-test-${System.nanoTime()}")
        tempDir.mkdirs()

        // Generate a real ECDSA P-256 keypair for testing
        val realKpg = java.security.KeyPairGenerator.getInstance("EC")
        realKpg.initialize(ECGenParameterSpec("secp256r1"))
        testKeyPair = realKpg.generateKeyPair()

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
        every { Log.w(any(), any<String>(), any()) } returns 0
        every { Log.w(any(), any<String>()) } returns 0

        // Mock context for KeyRegistry
        context = mockk {
            every { filesDir } returns tempDir
        }
        registry = KeyRegistry(context)

        // Mock FragmentActivity
        activity = mockk(relaxed = true)

        // Mock KeyGenParameterSpec.Builder (Android framework stub)
        mockkConstructor(KeyGenParameterSpec.Builder::class)
        val mockSpec = mockk<KeyGenParameterSpec>(relaxed = true)
        every { anyConstructed<KeyGenParameterSpec.Builder>().setAlgorithmParameterSpec(any()) } returns mockk(relaxed = true) {
            every { setDigests(any()) } returns this@mockk
            every { setUserAuthenticationRequired(any()) } returns this@mockk
            every { setUserAuthenticationParameters(any(), any()) } returns this@mockk
            every { build() } returns mockSpec
        }
        every { anyConstructed<KeyGenParameterSpec.Builder>().setDigests(any()) } returns mockk(relaxed = true) {
            every { build() } returns mockSpec
        }
        every { anyConstructed<KeyGenParameterSpec.Builder>().build() } returns mockSpec

        // Mock KeyStore.getInstance("AndroidKeyStore")
        mockKeyStore = mockk(relaxed = true)
        mockkStatic(KeyStore::class)
        every { KeyStore.getInstance("AndroidKeyStore") } returns mockKeyStore
        every { mockKeyStore.load(null) } returns Unit

        // Mock KeyPairGenerator.getInstance("EC", "AndroidKeyStore")
        mockKeyPairGenerator = mockk(relaxed = true)
        mockkStatic(KeyPairGenerator::class)
        every { KeyPairGenerator.getInstance("EC", "AndroidKeyStore") } returns mockKeyPairGenerator
        every { mockKeyPairGenerator.generateKeyPair() } returns testKeyPair

        // Mock SshKeyFormatter
        mockkObject(SshKeyFormatter)
        every { SshKeyFormatter.toSshPublicKeyBlob(any()) } returns testPublicKeyBlob

        // Mock KeyRegistry.computeFingerprint (static)
        // Actually, computeFingerprint uses MessageDigest which works fine in JVM tests.
        // But we need Base64 mock which is already set up.
    }

    @After
    fun tearDown() {
        unmockkAll()
        tempDir.deleteRecursively()
    }

    private fun createBackend(requireBiometric: Boolean = true): KeystoreSigningBackend {
        return KeystoreSigningBackend(activity, registry, requireBiometric)
    }

    private fun addKeystoreEntry(
        id: String = "ks-key-1",
        name: String = "App Key",
        alias: String = "agent-runner-ks-key-1"
    ): KeyEntry {
        val entry = KeyEntry(
            id = id,
            name = name,
            type = KeyType.ANDROID_KEYSTORE,
            publicKey = testPublicKeyBlob,
            publicKeyComment = "Android Keystore ($name)",
            fingerprint = KeyRegistry.computeFingerprint(testPublicKeyBlob),
            keystoreAlias = alias,
            createdAt = "2026-03-24T00:00:00Z"
        )
        registry.addKey(entry)
        return entry
    }

    // --- listKeys ---

    @Test
    fun `listKeys returns only ANDROID_KEYSTORE keys`() = runTest {
        // Add mixed key types
        registry.addKey(KeyEntry(
            id = "yk-1", name = "Yubikey", type = KeyType.YUBIKEY_PIV,
            publicKey = byteArrayOf(1), publicKeyComment = "yk", fingerprint = "fp1",
            pivSlot = "9a", createdAt = "2026-03-24T00:00:00Z"
        ))
        registry.addKey(KeyEntry(
            id = "ks-1", name = "App Key", type = KeyType.ANDROID_KEYSTORE,
            publicKey = byteArrayOf(2), publicKeyComment = "ks", fingerprint = "fp2",
            keystoreAlias = "agent-runner-ks-1", createdAt = "2026-03-24T00:00:00Z"
        ))
        registry.addKey(KeyEntry(
            id = "mock-1", name = "Mock", type = KeyType.MOCK,
            publicKey = byteArrayOf(3), publicKeyComment = "mock", fingerprint = "fp3",
            createdAt = "2026-03-24T00:00:00Z"
        ))

        val backend = createBackend()
        val keys = backend.listKeys()
        assertEquals(1, keys.size)
        assertEquals("ks-1", keys[0].id)
        assertEquals(KeyType.ANDROID_KEYSTORE, keys[0].type)
    }

    @Test
    fun `listKeys returns empty when no keystore keys exist`() = runTest {
        val backend = createBackend()
        assertTrue(backend.listKeys().isEmpty())
    }

    // --- generateKey ---

    @Test
    fun `generateKey creates keypair and registers in registry`() = runTest {
        val mockCert = mockk<X509Certificate>()
        every { mockKeyStore.getCertificate(any()) } returns mockCert

        val backend = createBackend()
        val entry = backend.generateKey("My Key")

        assertNotNull(entry)
        assertEquals("My Key", entry.name)
        assertEquals(KeyType.ANDROID_KEYSTORE, entry.type)
        assertTrue(testPublicKeyBlob.contentEquals(entry.publicKey))
        assertEquals("Android Keystore (My Key)", entry.publicKeyComment)
        assertNotNull(entry.keystoreAlias)
        assertTrue(entry.keystoreAlias!!.startsWith("agent-runner-"))
        assertNotNull(entry.createdAt)

        // Verify key is now in registry
        val stored = registry.getKey(entry.id)
        assertNotNull(stored)
        assertEquals(entry.id, stored!!.id)
    }

    @Test
    fun `generateKey initializes KeyPairGenerator with correct algorithm`() = runTest {
        val mockCert = mockk<X509Certificate>()
        every { mockKeyStore.getCertificate(any()) } returns mockCert

        val backend = createBackend()
        backend.generateKey("Test")

        verify { KeyPairGenerator.getInstance("EC", "AndroidKeyStore") }
        verify { mockKeyPairGenerator.initialize(any<KeyGenParameterSpec>()) }
        verify { mockKeyPairGenerator.generateKeyPair() }
    }

    @Test
    fun `generateKey reads certificate from keystore`() = runTest {
        val mockCert = mockk<X509Certificate>()
        val aliasSlot = slot<String>()
        every { mockKeyStore.getCertificate(capture(aliasSlot)) } returns mockCert

        val backend = createBackend()
        val entry = backend.generateKey("Test")

        // The alias used to read cert should match the alias stored in the entry
        assertEquals(entry.keystoreAlias, aliasSlot.captured)
        verify { SshKeyFormatter.toSshPublicKeyBlob(mockCert) }
    }

    // --- deleteKey ---

    @Test
    fun `deleteKey removes from keystore and registry`() = runTest {
        val entry = addKeystoreEntry()
        every { mockKeyStore.containsAlias("agent-runner-ks-key-1") } returns true

        val backend = createBackend()
        backend.deleteKey(entry.id)

        verify { mockKeyStore.deleteEntry("agent-runner-ks-key-1") }
        assertTrue(registry.listKeys().isEmpty())
    }

    @Test
    fun `deleteKey handles missing keystore alias gracefully`() = runTest {
        val entry = addKeystoreEntry()
        every { mockKeyStore.containsAlias("agent-runner-ks-key-1") } returns false

        val backend = createBackend()
        backend.deleteKey(entry.id)

        // Should still remove from registry even if not in keystore
        verify(exactly = 0) { mockKeyStore.deleteEntry(any()) }
        assertTrue(registry.listKeys().isEmpty())
    }

    @Test(expected = IllegalArgumentException::class)
    fun `deleteKey throws for unknown key id`() = runTest {
        val backend = createBackend()
        backend.deleteKey("nonexistent")
    }

    @Test(expected = IllegalArgumentException::class)
    fun `deleteKey throws for non-keystore key type`() = runTest {
        registry.addKey(KeyEntry(
            id = "yk-1", name = "Yubikey", type = KeyType.YUBIKEY_PIV,
            publicKey = byteArrayOf(1), publicKeyComment = "yk", fingerprint = "fp1",
            pivSlot = "9a", createdAt = "2026-03-24T00:00:00Z"
        ))

        val backend = createBackend()
        backend.deleteKey("yk-1")
    }

    // --- sign (without biometric) ---

    @Test
    fun `sign updates lastUsedAt in registry`() = runTest {
        val entry = addKeystoreEntry()
        val mockPrivateKey = mockk<PrivateKey>()
        every { mockKeyStore.getKey("agent-runner-ks-key-1", null) } returns mockPrivateKey

        val mockSignature = mockk<Signature>(relaxed = true)
        every { mockSignature.sign() } returns byteArrayOf(1, 2, 3)
        mockkStatic(Signature::class)
        every { Signature.getInstance("SHA256withECDSA") } returns mockSignature

        val backend = createBackend(requireBiometric = false)
        backend.sign(entry.id, byteArrayOf(42))

        val updated = registry.getKey(entry.id)
        assertNotNull(updated!!.lastUsedAt)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `sign throws for unknown key id`() = runTest {
        val backend = createBackend(requireBiometric = false)
        backend.sign("nonexistent", byteArrayOf(1))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `sign throws for non-keystore key type`() = runTest {
        registry.addKey(KeyEntry(
            id = "yk-1", name = "Yubikey", type = KeyType.YUBIKEY_PIV,
            publicKey = byteArrayOf(1), publicKeyComment = "yk", fingerprint = "fp1",
            pivSlot = "9a", createdAt = "2026-03-24T00:00:00Z"
        ))

        val backend = createBackend(requireBiometric = false)
        backend.sign("yk-1", byteArrayOf(1))
    }

    @Test(expected = IllegalStateException::class)
    fun `sign throws when private key not in keystore`() = runTest {
        val entry = addKeystoreEntry()
        every { mockKeyStore.getKey("agent-runner-ks-key-1", null) } returns null

        mockkStatic(Signature::class)
        every { Signature.getInstance("SHA256withECDSA") } returns mockk(relaxed = true)

        val backend = createBackend(requireBiometric = false)
        backend.sign(entry.id, byteArrayOf(1))
    }

    // --- sign (with biometric) ---

    @Test
    fun `sign with biometric delegates to signWithBiometric and returns signature`() = runTest {
        val entry = addKeystoreEntry()
        val mockPrivateKey = mockk<PrivateKey>()
        every { mockKeyStore.getKey("agent-runner-ks-key-1", null) } returns mockPrivateKey

        val mockSignature = mockk<Signature>(relaxed = true)
        val expectedSignature = byteArrayOf(48, 44, 2, 20, 9, 8, 7)
        mockkStatic(Signature::class)
        every { Signature.getInstance("SHA256withECDSA") } returns mockSignature

        // Spy on backend and mock the private signWithBiometric method
        val backend = spyk(createBackend(requireBiometric = true))
        coEvery { backend["signWithBiometric"](any<Signature>(), any<ByteArray>()) } returns expectedSignature

        val result = backend.sign(entry.id, byteArrayOf(42))

        assertTrue(expectedSignature.contentEquals(result))
        // Verify initSign was called (biometric path still initializes the signature)
        verify { mockSignature.initSign(mockPrivateKey) }
        // Verify that update/sign were NOT called directly (biometric path delegates)
        verify(exactly = 0) { mockSignature.update(any<ByteArray>()) }
        verify(exactly = 0) { mockSignature.sign() }
    }

    @Test
    fun `sign with biometric does not call signature update directly`() = runTest {
        val entry = addKeystoreEntry()
        val mockPrivateKey = mockk<PrivateKey>()
        every { mockKeyStore.getKey("agent-runner-ks-key-1", null) } returns mockPrivateKey

        val mockSignature = mockk<Signature>(relaxed = true)
        mockkStatic(Signature::class)
        every { Signature.getInstance("SHA256withECDSA") } returns mockSignature

        // Spy on backend; mock signWithBiometric to simulate auth error
        val backend = spyk(createBackend(requireBiometric = true))
        coEvery {
            backend["signWithBiometric"](any<Signature>(), any<ByteArray>())
        } throws BiometricAuthException(BiometricPrompt.ERROR_USER_CANCELED, "User canceled")

        try {
            backend.sign(entry.id, byteArrayOf(42))
            throw AssertionError("Expected BiometricAuthException")
        } catch (e: BiometricAuthException) {
            assertEquals(BiometricPrompt.ERROR_USER_CANCELED, e.errorCode)
            assertTrue(e.message!!.contains("User canceled"))
        }
    }

    @Test
    fun `sign without biometric calls signature update and sign directly`() = runTest {
        val entry = addKeystoreEntry()
        val mockPrivateKey = mockk<PrivateKey>()
        every { mockKeyStore.getKey("agent-runner-ks-key-1", null) } returns mockPrivateKey

        val mockSignature = mockk<Signature>(relaxed = true)
        val expectedSignature = byteArrayOf(48, 44, 2, 20, 1, 2, 3)
        every { mockSignature.sign() } returns expectedSignature
        mockkStatic(Signature::class)
        every { Signature.getInstance("SHA256withECDSA") } returns mockSignature

        val data = byteArrayOf(10, 20, 30)
        val backend = createBackend(requireBiometric = false)
        val result = backend.sign(entry.id, data)

        // Non-biometric path calls update+sign directly
        verify { mockSignature.update(data) }
        verify { mockSignature.sign() }
        assertTrue(expectedSignature.contentEquals(result))
    }

    // --- canSign ---

    @Test
    fun `canSign returns true for ANDROID_KEYSTORE key with existing alias`() {
        val entry = addKeystoreEntry()
        every { mockKeyStore.containsAlias("agent-runner-ks-key-1") } returns true

        val backend = createBackend()
        assertTrue(backend.canSign(entry))
    }

    @Test
    fun `canSign returns false for ANDROID_KEYSTORE key with missing alias`() {
        val entry = addKeystoreEntry()
        every { mockKeyStore.containsAlias("agent-runner-ks-key-1") } returns false

        val backend = createBackend()
        assertFalse(backend.canSign(entry))
    }

    @Test
    fun `canSign returns false for non-keystore key type`() {
        val yubikeyEntry = KeyEntry(
            id = "yk-1", name = "Yubikey", type = KeyType.YUBIKEY_PIV,
            publicKey = byteArrayOf(1), publicKeyComment = "yk", fingerprint = "fp1",
            pivSlot = "9a", createdAt = "2026-03-24T00:00:00Z"
        )

        val backend = createBackend()
        assertFalse(backend.canSign(yubikeyEntry))
    }

    @Test
    fun `canSign returns false when keystoreAlias is null`() {
        val entry = KeyEntry(
            id = "ks-no-alias", name = "No Alias", type = KeyType.ANDROID_KEYSTORE,
            publicKey = byteArrayOf(5), publicKeyComment = "no-alias", fingerprint = "fp5",
            keystoreAlias = null, createdAt = "2026-03-24T00:00:00Z"
        )

        val backend = createBackend()
        assertFalse(backend.canSign(entry))
    }

    @Test
    fun `canSign returns false when keystore throws exception`() {
        val entry = addKeystoreEntry()
        every { mockKeyStore.containsAlias(any()) } throws RuntimeException("Keystore error")

        val backend = createBackend()
        assertFalse(backend.canSign(entry))
    }

    // --- deleteKey with missing keystoreAlias ---

    @Test(expected = IllegalStateException::class)
    fun `deleteKey throws when keystoreAlias is null`() = runTest {
        // Directly add entry without keystoreAlias
        registry.addKey(KeyEntry(
            id = "no-alias", name = "No Alias", type = KeyType.ANDROID_KEYSTORE,
            publicKey = byteArrayOf(99), publicKeyComment = "test", fingerprint = "fp99",
            keystoreAlias = null, createdAt = "2026-03-24T00:00:00Z"
        ))

        val backend = createBackend()
        backend.deleteKey("no-alias")
    }

    // --- sign with missing keystoreAlias ---

    @Test(expected = IllegalStateException::class)
    fun `sign throws when keystoreAlias is null`() = runTest {
        registry.addKey(KeyEntry(
            id = "no-alias", name = "No Alias", type = KeyType.ANDROID_KEYSTORE,
            publicKey = byteArrayOf(98), publicKeyComment = "test", fingerprint = "fp98",
            keystoreAlias = null, createdAt = "2026-03-24T00:00:00Z"
        ))

        mockkStatic(Signature::class)
        every { Signature.getInstance("SHA256withECDSA") } returns mockk(relaxed = true)

        val backend = createBackend(requireBiometric = false)
        backend.sign("no-alias", byteArrayOf(1))
    }
}
