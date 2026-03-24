package com.agentrunner.signing

import android.content.Context
import android.util.Log
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.PrivateKey
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.PKCS8EncodedKeySpec
import java.time.Instant
import java.util.UUID

/**
 * Debug/test signing backend that auto-signs with an idempotently-generated
 * ECDSA P-256 keypair. No user interaction required.
 *
 * The keypair is generated once and persisted to app-private storage.
 * Subsequent instantiations reuse the same keypair.
 *
 * Only available in debug builds (lives in src/debug/).
 */
class MockSigningBackend(
    private val context: Context,
    private val registry: KeyRegistry
) : SigningBackend {

    companion object {
        private const val TAG = "MockSigningBackend"
        private const val PRIVATE_KEY_FILE = "mock-signing-key.der"
        private const val PUBLIC_KEY_FILE = "mock-signing-key.pub"
        private const val KEY_COMMENT = "Mock Test Key"
        private const val SIGNATURE_ALGORITHM = "SHA256withECDSA"
    }

    private lateinit var privateKey: PrivateKey
    private lateinit var publicKeyBlob: ByteArray
    private lateinit var keyId: String

    /**
     * Initialize the mock backend: load or generate the test keypair,
     * and register it in the KeyRegistry if not already present.
     *
     * Must be called before [listKeys], [sign], or [canSign].
     */
    fun initialize() {
        val privFile = File(context.filesDir, PRIVATE_KEY_FILE)
        val pubFile = File(context.filesDir, PUBLIC_KEY_FILE)

        if (privFile.exists() && pubFile.exists()) {
            // Reload existing keypair
            val privBytes = privFile.readBytes()
            privateKey = KeyFactory.getInstance("EC")
                .generatePrivate(PKCS8EncodedKeySpec(privBytes))
            publicKeyBlob = pubFile.readBytes()
            Log.i(TAG, "Loaded existing mock keypair")
        } else {
            // Generate new keypair
            val kpg = KeyPairGenerator.getInstance("EC")
            kpg.initialize(ECGenParameterSpec("secp256r1"))
            val keyPair = kpg.generateKeyPair()

            privateKey = keyPair.private
            publicKeyBlob = ecPublicKeyToSshBlob(keyPair.public as ECPublicKey)

            // Persist for idempotency
            privFile.writeBytes(privateKey.encoded)
            pubFile.writeBytes(publicKeyBlob)
            Log.i(TAG, "Generated new mock keypair")
        }

        // Register in KeyRegistry if not already present
        val existing = registry.findByPublicKey(publicKeyBlob)
        if (existing != null) {
            keyId = existing.id
            Log.i(TAG, "Mock key already registered: ${existing.fingerprint}")
        } else {
            keyId = UUID.randomUUID().toString()
            val fingerprint = KeyRegistry.computeFingerprint(publicKeyBlob)
            val entry = KeyEntry(
                id = keyId,
                name = KEY_COMMENT,
                type = KeyType.MOCK,
                publicKey = publicKeyBlob,
                publicKeyComment = KEY_COMMENT,
                fingerprint = fingerprint,
                createdAt = Instant.now().toString()
            )
            registry.addKey(entry)
            Log.i(TAG, "Registered mock key: $fingerprint")
        }
    }

    override suspend fun listKeys(): List<KeyEntry> {
        return registry.listKeys().filter { it.type == KeyType.MOCK }
    }

    override suspend fun sign(keyId: String, data: ByteArray): ByteArray {
        val entry = registry.getKey(keyId)
            ?: throw IllegalArgumentException("Key not found: $keyId")
        if (entry.type != KeyType.MOCK) {
            throw IllegalArgumentException("Key $keyId is not a mock key")
        }

        val sig = Signature.getInstance(SIGNATURE_ALGORITHM)
        sig.initSign(privateKey)
        sig.update(data)
        val signed = sig.sign()

        updateLastUsed(keyId)
        Log.d(TAG, "Auto-signed ${data.size} bytes with mock key")
        return signed
    }

    override fun canSign(keyEntry: KeyEntry): Boolean {
        return keyEntry.type == KeyType.MOCK
    }

    /**
     * Convert an ECPublicKey to SSH wire format blob.
     * Format: string("ecdsa-sha2-nistp256") + string("nistp256") + string(0x04 || x || y)
     */
    private fun ecPublicKeyToSshBlob(ecKey: ECPublicKey): ByteArray {
        val w = ecKey.w
        val xBytes = bigIntToFixedBytes(w.affineX, 32)
        val yBytes = bigIntToFixedBytes(w.affineY, 32)

        val ecPoint = ByteArray(1 + 32 + 32)
        ecPoint[0] = 0x04
        xBytes.copyInto(ecPoint, 1)
        yBytes.copyInto(ecPoint, 1 + 32)

        val out = ByteArrayOutputStream()
        out.writeSshString("ecdsa-sha2-nistp256".toByteArray())
        out.writeSshString("nistp256".toByteArray())
        out.writeSshString(ecPoint)
        return out.toByteArray()
    }

    private fun bigIntToFixedBytes(value: java.math.BigInteger, size: Int): ByteArray {
        val raw = value.toByteArray()
        return when {
            raw.size == size -> raw
            raw.size > size -> raw.copyOfRange(raw.size - size, raw.size)
            else -> ByteArray(size).also { raw.copyInto(it, size - raw.size) }
        }
    }

    private fun ByteArrayOutputStream.writeSshString(data: ByteArray) {
        val buf = ByteBuffer.allocate(4)
        buf.putInt(data.size)
        write(buf.array())
        write(data)
    }

    private fun updateLastUsed(keyId: String) {
        try {
            registry.updateLastUsed(keyId, Instant.now().toString())
        } catch (e: Exception) {
            Log.w(TAG, "Failed to update lastUsedAt for key $keyId", e)
        }
    }
}
