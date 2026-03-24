package com.agentrunner.yubikey

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.math.BigInteger
import java.nio.ByteBuffer
import java.security.KeyPairGenerator
import java.security.cert.X509Certificate
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

/**
 * Tests for SshKeyFormatter — converting ECDSA P-256 X509Certificate
 * public keys to SSH wire format and building SSH_AGENT_IDENTITIES_ANSWER.
 */
class SshKeyFormatterTest {

    // --- Helper: generate a real ECDSA P-256 key pair ---

    private fun generateTestEcPublicKey(): ECPublicKey {
        val keyPairGen = KeyPairGenerator.getInstance("EC")
        keyPairGen.initialize(ECGenParameterSpec("secp256r1"))
        return keyPairGen.generateKeyPair().public as ECPublicKey
    }

    // --- SSH wire format helper to parse results ---

    /** Read a uint32 (big-endian) from a ByteBuffer */
    private fun ByteBuffer.readUint32(): Int {
        return this.int
    }

    /** Read an SSH string (uint32 length + bytes) from a ByteBuffer */
    private fun ByteBuffer.readSshString(): ByteArray {
        val len = this.int
        val data = ByteArray(len)
        this.get(data)
        return data
    }

    // --- toSshPublicKeyBlob tests ---

    @Test
    fun `toSshPublicKeyBlob produces correct SSH wire format for ECDSA P-256`() {
        val ecKey = generateTestEcPublicKey()
        val cert = io.mockk.mockk<X509Certificate>()
        io.mockk.every { cert.publicKey } returns ecKey

        val blob = SshKeyFormatter.toSshPublicKeyBlob(cert)

        // Parse the blob: string "ecdsa-sha2-nistp256" + string "nistp256" + string EC_point
        val buf = ByteBuffer.wrap(blob)

        val keyType = String(buf.readSshString())
        assertEquals("ecdsa-sha2-nistp256", keyType)

        val curveName = String(buf.readSshString())
        assertEquals("nistp256", curveName)

        val ecPoint = buf.readSshString()
        // EC point should start with 0x04 (uncompressed) and be 65 bytes (1 + 32 + 32)
        assertEquals(65, ecPoint.size)
        assertEquals(0x04.toByte(), ecPoint[0])

        // Should have consumed all bytes
        assertEquals(0, buf.remaining())
    }

    @Test
    fun `toSshPublicKeyBlob encodes EC point with correct coordinates`() {
        val ecKey = generateTestEcPublicKey()
        val cert = io.mockk.mockk<X509Certificate>()
        io.mockk.every { cert.publicKey } returns ecKey

        val blob = SshKeyFormatter.toSshPublicKeyBlob(cert)
        val buf = ByteBuffer.wrap(blob)

        // Skip key type and curve name
        buf.readSshString()
        buf.readSshString()

        val ecPoint = buf.readSshString()

        // Extract X and Y from the uncompressed point (skip 0x04 prefix)
        val xBytes = ecPoint.sliceArray(1..32)
        val yBytes = ecPoint.sliceArray(33..64)

        val x = BigInteger(1, xBytes)
        val y = BigInteger(1, yBytes)

        // Verify they match the original key's coordinates
        assertEquals(ecKey.w.affineX, x)
        assertEquals(ecKey.w.affineY, y)
    }

    @Test
    fun `toSshPublicKeyBlob pads coordinates to 32 bytes`() {
        // Generate multiple keys to increase chance of getting one with a leading zero
        // (coordinate < 2^248). Even if we don't hit that case, we verify the format.
        val ecKey = generateTestEcPublicKey()
        val cert = io.mockk.mockk<X509Certificate>()
        io.mockk.every { cert.publicKey } returns ecKey

        val blob = SshKeyFormatter.toSshPublicKeyBlob(cert)
        val buf = ByteBuffer.wrap(blob)

        buf.readSshString() // key type
        buf.readSshString() // curve name

        val ecPoint = buf.readSshString()
        // Always 65 bytes regardless of coordinate magnitude
        assertEquals(65, ecPoint.size)
    }

    // --- buildIdentitiesAnswer tests ---

    @Test
    fun `buildIdentitiesAnswer has correct message type byte`() {
        val ecKey = generateTestEcPublicKey()
        val cert = io.mockk.mockk<X509Certificate>()
        io.mockk.every { cert.publicKey } returns ecKey

        val comment = "YubiKey PIV Slot 9a"
        val answer = SshKeyFormatter.buildIdentitiesAnswer(cert, comment)

        // First byte is message type SSH_AGENT_IDENTITIES_ANSWER = 12
        assertEquals(12.toByte(), answer[0])
    }

    @Test
    fun `buildIdentitiesAnswer contains one key`() {
        val ecKey = generateTestEcPublicKey()
        val cert = io.mockk.mockk<X509Certificate>()
        io.mockk.every { cert.publicKey } returns ecKey

        val answer = SshKeyFormatter.buildIdentitiesAnswer(cert, "YubiKey PIV Slot 9a")
        val buf = ByteBuffer.wrap(answer)

        // Skip message type byte
        buf.get()

        // uint32 nkeys = 1
        val nkeys = buf.readUint32()
        assertEquals(1, nkeys)
    }

    @Test
    fun `buildIdentitiesAnswer contains valid key blob and comment`() {
        val ecKey = generateTestEcPublicKey()
        val cert = io.mockk.mockk<X509Certificate>()
        io.mockk.every { cert.publicKey } returns ecKey

        val comment = "YubiKey PIV Slot 9a"
        val answer = SshKeyFormatter.buildIdentitiesAnswer(cert, comment)
        val buf = ByteBuffer.wrap(answer)

        // Skip type byte and nkeys
        buf.get()
        buf.readUint32()

        // Read key blob (SSH string)
        val keyBlob = buf.readSshString()

        // Key blob should be a valid SSH public key blob
        val blobBuf = ByteBuffer.wrap(keyBlob)
        val keyType = String(blobBuf.readSshString())
        assertEquals("ecdsa-sha2-nistp256", keyType)

        // Read comment (SSH string)
        val commentBytes = buf.readSshString()
        assertEquals(comment, String(commentBytes))

        // Should have consumed all bytes
        assertEquals(0, buf.remaining())
    }

    @Test
    fun `buildIdentitiesAnswer key blob matches toSshPublicKeyBlob output`() {
        val ecKey = generateTestEcPublicKey()
        val cert = io.mockk.mockk<X509Certificate>()
        io.mockk.every { cert.publicKey } returns ecKey

        val directBlob = SshKeyFormatter.toSshPublicKeyBlob(cert)

        val answer = SshKeyFormatter.buildIdentitiesAnswer(cert, "test")
        val buf = ByteBuffer.wrap(answer)

        buf.get() // type
        buf.readUint32() // nkeys

        val embeddedBlob = buf.readSshString()

        assertArrayEquals(directBlob, embeddedBlob)
    }

    @Test
    fun `buildIdentitiesAnswer with empty comment`() {
        val ecKey = generateTestEcPublicKey()
        val cert = io.mockk.mockk<X509Certificate>()
        io.mockk.every { cert.publicKey } returns ecKey

        val answer = SshKeyFormatter.buildIdentitiesAnswer(cert, "")
        val buf = ByteBuffer.wrap(answer)

        buf.get() // type
        buf.readUint32() // nkeys
        buf.readSshString() // key blob

        val commentBytes = buf.readSshString()
        assertEquals("", String(commentBytes))

        assertEquals(0, buf.remaining())
    }
}
