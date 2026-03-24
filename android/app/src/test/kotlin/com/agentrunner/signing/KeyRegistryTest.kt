package com.agentrunner.signing

import android.content.Context
import android.util.Base64
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkStatic
import io.mockk.unmockkStatic
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class KeyRegistryTest {

    private lateinit var tempDir: File
    private lateinit var context: Context
    private lateinit var registry: KeyRegistry

    @Before
    fun setUp() {
        tempDir = File(System.getProperty("java.io.tmpdir"), "key-registry-test-${System.nanoTime()}")
        tempDir.mkdirs()

        context = mockk {
            every { filesDir } returns tempDir
        }

        // Mock android.util.Base64 to use java.util.Base64.
        // Always use no-wrap, no-padding encoding — matches the most restrictive
        // flags used in KeyRegistry (NO_WRAP | NO_PADDING). Standard decoder handles both.
        mockkStatic(Base64::class)
        every { Base64.encodeToString(any<ByteArray>(), any()) } answers {
            java.util.Base64.getEncoder().withoutPadding().encodeToString(firstArg<ByteArray>())
        }
        every { Base64.decode(any<String>(), any()) } answers {
            java.util.Base64.getDecoder().decode(firstArg<String>())
        }

        registry = KeyRegistry(context)
    }

    @After
    fun tearDown() {
        unmockkStatic(Base64::class)
        tempDir.deleteRecursively()
    }

    // --- Helpers ---

    private fun makeEntry(
        id: String = "key-1",
        name: String = "Test Key",
        type: KeyType = KeyType.YUBIKEY_PIV,
        publicKey: ByteArray = byteArrayOf(1, 2, 3, 4),
        comment: String = "test@host",
        pivSlot: String? = "9a",
        keystoreAlias: String? = null,
        createdAt: String = "2026-03-24T00:00:00Z",
        lastUsedAt: String? = null
    ): KeyEntry {
        val fingerprint = KeyRegistry.computeFingerprint(publicKey)
        return KeyEntry(
            id = id,
            name = name,
            type = type,
            publicKey = publicKey,
            publicKeyComment = comment,
            fingerprint = fingerprint,
            pivSlot = pivSlot,
            keystoreAlias = keystoreAlias,
            createdAt = createdAt,
            lastUsedAt = lastUsedAt
        )
    }

    // --- CRUD ---

    @Test
    fun `listKeys returns empty when no file exists`() {
        assertEquals(emptyList<KeyEntry>(), registry.listKeys())
    }

    @Test
    fun `addKey and listKeys round-trip`() {
        val entry = makeEntry()
        registry.addKey(entry)

        val keys = registry.listKeys()
        assertEquals(1, keys.size)
        assertEquals("key-1", keys[0].id)
        assertEquals("Test Key", keys[0].name)
        assertEquals(KeyType.YUBIKEY_PIV, keys[0].type)
        assertTrue(byteArrayOf(1, 2, 3, 4).contentEquals(keys[0].publicKey))
        assertEquals("test@host", keys[0].publicKeyComment)
        assertEquals("9a", keys[0].pivSlot)
        assertNull(keys[0].keystoreAlias)
        assertEquals("2026-03-24T00:00:00Z", keys[0].createdAt)
        assertNull(keys[0].lastUsedAt)
    }

    @Test
    fun `addKey persists multiple keys`() {
        registry.addKey(makeEntry(id = "k1", publicKey = byteArrayOf(1)))
        registry.addKey(makeEntry(id = "k2", publicKey = byteArrayOf(2)))
        registry.addKey(makeEntry(id = "k3", publicKey = byteArrayOf(3)))

        assertEquals(3, registry.listKeys().size)
    }

    @Test
    fun `getKey returns entry by id`() {
        registry.addKey(makeEntry(id = "target", publicKey = byteArrayOf(10)))
        registry.addKey(makeEntry(id = "other", publicKey = byteArrayOf(20)))

        val result = registry.getKey("target")
        assertNotNull(result)
        assertEquals("target", result!!.id)
    }

    @Test
    fun `getKey returns null for missing id`() {
        registry.addKey(makeEntry())
        assertNull(registry.getKey("nonexistent"))
    }

    @Test
    fun `removeKey deletes entry and returns true`() {
        registry.addKey(makeEntry(id = "to-remove"))
        assertTrue(registry.removeKey("to-remove"))
        assertEquals(0, registry.listKeys().size)
    }

    @Test
    fun `removeKey returns false for missing id`() {
        assertFalse(registry.removeKey("nonexistent"))
    }

    @Test
    fun `updateKey transforms entry in place`() {
        registry.addKey(makeEntry(id = "k1", name = "Old Name"))
        registry.updateKey("k1") { it.copy(name = "New Name") }

        assertEquals("New Name", registry.getKey("k1")!!.name)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `updateKey throws for missing id`() {
        registry.updateKey("nonexistent") { it }
    }

    @Test
    fun `updateLastUsed sets timestamp`() {
        registry.addKey(makeEntry(id = "k1"))
        assertNull(registry.getKey("k1")!!.lastUsedAt)

        registry.updateLastUsed("k1", "2026-03-24T12:00:00Z")
        assertEquals("2026-03-24T12:00:00Z", registry.getKey("k1")!!.lastUsedAt)
    }

    // --- JSON serialization ---

    @Test
    fun `JSON round-trip preserves all fields including nulls`() {
        val entry = makeEntry(
            type = KeyType.ANDROID_KEYSTORE,
            pivSlot = null,
            keystoreAlias = "agent-runner-abc123",
            lastUsedAt = "2026-03-24T06:00:00Z"
        )
        registry.addKey(entry)

        val loaded = registry.listKeys()[0]
        assertEquals(KeyType.ANDROID_KEYSTORE, loaded.type)
        assertNull(loaded.pivSlot)
        assertEquals("agent-runner-abc123", loaded.keystoreAlias)
        assertEquals("2026-03-24T06:00:00Z", loaded.lastUsedAt)
    }

    @Test
    fun `JSON round-trip preserves mock key type`() {
        val entry = makeEntry(id = "mock-1", type = KeyType.MOCK, pivSlot = null)
        registry.addKey(entry)
        assertEquals(KeyType.MOCK, registry.listKeys()[0].type)
    }

    @Test
    fun `keys json file is valid JSON`() {
        registry.addKey(makeEntry())
        val raw = File(tempDir, "keys.json").readText()
        // Should parse without error
        org.json.JSONArray(raw)
    }

    // --- Duplicate detection ---

    @Test(expected = IllegalArgumentException::class)
    fun `addKey rejects duplicate id`() {
        registry.addKey(makeEntry(id = "dup", publicKey = byteArrayOf(1)))
        registry.addKey(makeEntry(id = "dup", publicKey = byteArrayOf(2)))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `addKey rejects duplicate public key`() {
        val sameKey = byteArrayOf(99, 98, 97)
        registry.addKey(makeEntry(id = "a", publicKey = sameKey))
        registry.addKey(makeEntry(id = "b", publicKey = sameKey))
    }

    // --- Lookup by public key ---

    @Test
    fun `findByPublicKey returns matching entry`() {
        val pk = byteArrayOf(10, 20, 30)
        registry.addKey(makeEntry(id = "target", publicKey = pk))
        registry.addKey(makeEntry(id = "other", publicKey = byteArrayOf(40, 50)))

        val result = registry.findByPublicKey(pk)
        assertNotNull(result)
        assertEquals("target", result!!.id)
    }

    @Test
    fun `findByPublicKey returns null when no match`() {
        registry.addKey(makeEntry(publicKey = byteArrayOf(1)))
        assertNull(registry.findByPublicKey(byteArrayOf(99)))
    }

    // --- Lookup by fingerprint ---

    @Test
    fun `findByFingerprint returns matching entry`() {
        val pk = byteArrayOf(5, 6, 7)
        val fp = KeyRegistry.computeFingerprint(pk)
        registry.addKey(makeEntry(id = "fp-match", publicKey = pk))

        val result = registry.findByFingerprint(fp)
        assertNotNull(result)
        assertEquals("fp-match", result!!.id)
    }

    @Test
    fun `findByFingerprint returns null when no match`() {
        assertNull(registry.findByFingerprint("SHA256:nonexistent"))
    }

    // --- SSH key format export ---

    @Test
    fun `exportAuthorizedKey produces correct format`() {
        val pk = byteArrayOf(0, 0, 0, 7) // arbitrary blob
        val entry = makeEntry(publicKey = pk, comment = "user@example.com")
        registry.addKey(entry)

        val exported = registry.exportAuthorizedKey(entry)
        assertTrue(exported.startsWith("ecdsa-sha2-nistp256 "))
        assertTrue(exported.endsWith(" user@example.com"))

        // Middle part should be valid base64 of the public key
        val parts = exported.split(" ")
        assertEquals(3, parts.size)
        val decoded = java.util.Base64.getDecoder().decode(parts[1])
        assertTrue(pk.contentEquals(decoded))
    }

    // --- Fingerprint ---

    @Test
    fun `computeFingerprint returns SHA256 prefix`() {
        val fp = KeyRegistry.computeFingerprint(byteArrayOf(1, 2, 3))
        assertTrue(fp.startsWith("SHA256:"))
    }

    @Test
    fun `computeFingerprint is deterministic`() {
        val pk = byteArrayOf(42, 43, 44, 45)
        assertEquals(
            KeyRegistry.computeFingerprint(pk),
            KeyRegistry.computeFingerprint(pk)
        )
    }

    @Test
    fun `computeFingerprint differs for different keys`() {
        val fp1 = KeyRegistry.computeFingerprint(byteArrayOf(1))
        val fp2 = KeyRegistry.computeFingerprint(byteArrayOf(2))
        assertTrue(fp1 != fp2)
    }

    @Test
    fun `computeFingerprint matches manual SHA256`() {
        val pk = byteArrayOf(10, 20, 30)
        val digest = MessageDigest.getInstance("SHA-256").digest(pk)
        // Our Base64 mock always uses no-padding, matching computeFingerprint's NO_WRAP|NO_PADDING
        val expected = "SHA256:" + java.util.Base64.getEncoder().withoutPadding().encodeToString(digest)
        assertEquals(expected, KeyRegistry.computeFingerprint(pk))
    }
}
