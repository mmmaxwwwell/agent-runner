package com.agentrunner.signing

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.agentrunner.yubikey.SshKeyFormatter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.cert.X509Certificate
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.time.Instant
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * SigningBackend implementation using Android Keystore ECDSA P-256.
 *
 * Keys are generated in the Android Keystore (hardware-backed on most devices via TEE/StrongBox).
 * Signing is gated by BiometricPrompt when [requireBiometric] is true (default).
 *
 * Key aliases are prefixed with [ALIAS_PREFIX] to avoid collision with other apps.
 */
class KeystoreSigningBackend(
    private val activity: FragmentActivity,
    private val registry: KeyRegistry,
    private val requireBiometric: Boolean = true
) : SigningBackend {

    companion object {
        private const val TAG = "KeystoreSigningBackend"
        private const val ALIAS_PREFIX = "agent-runner-"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val SIGNATURE_ALGORITHM = "SHA256withECDSA"
        private const val KEY_COMMENT = "Android Keystore"
    }

    override suspend fun listKeys(): List<KeyEntry> {
        return registry.listKeys().filter { it.type == KeyType.ANDROID_KEYSTORE }
    }

    /**
     * Generate a new ECDSA P-256 keypair in the Android Keystore and register it in KeyRegistry.
     *
     * @param name user-assigned display name for the key
     * @return the newly created KeyEntry
     */
    suspend fun generateKey(name: String): KeyEntry = withContext(Dispatchers.Default) {
        val keyId = UUID.randomUUID().toString()
        val alias = ALIAS_PREFIX + keyId

        val specBuilder = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_SIGN
        )
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)

        if (requireBiometric) {
            specBuilder
                .setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        }

        val kpg = KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_EC,
            ANDROID_KEYSTORE
        )
        kpg.initialize(specBuilder.build())
        kpg.generateKeyPair()

        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
        keyStore.load(null)
        val cert = keyStore.getCertificate(alias) as X509Certificate
        val publicKeyBlob = SshKeyFormatter.toSshPublicKeyBlob(cert)
        val fingerprint = KeyRegistry.computeFingerprint(publicKeyBlob)

        val entry = KeyEntry(
            id = keyId,
            name = name,
            type = KeyType.ANDROID_KEYSTORE,
            publicKey = publicKeyBlob,
            publicKeyComment = "$KEY_COMMENT ($name)",
            fingerprint = fingerprint,
            keystoreAlias = alias,
            createdAt = Instant.now().toString()
        )
        registry.addKey(entry)
        Log.i(TAG, "Generated keystore key: $fingerprint")
        entry
    }

    /**
     * Delete a key from both the Android Keystore and the KeyRegistry.
     */
    suspend fun deleteKey(keyId: String) = withContext(Dispatchers.Default) {
        val entry = registry.getKey(keyId)
            ?: throw IllegalArgumentException("Key not found: $keyId")
        if (entry.type != KeyType.ANDROID_KEYSTORE) {
            throw IllegalArgumentException("Key $keyId is not an Android Keystore key")
        }

        val alias = entry.keystoreAlias
            ?: throw IllegalStateException("Key $keyId has no keystoreAlias")

        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
        keyStore.load(null)
        if (keyStore.containsAlias(alias)) {
            keyStore.deleteEntry(alias)
        }
        registry.removeKey(keyId)
        Log.i(TAG, "Deleted keystore key: $keyId")
    }

    override suspend fun sign(keyId: String, data: ByteArray): ByteArray {
        val entry = registry.getKey(keyId)
            ?: throw IllegalArgumentException("Key not found: $keyId")
        if (entry.type != KeyType.ANDROID_KEYSTORE) {
            throw IllegalArgumentException("Key $keyId is not an Android Keystore key")
        }

        val alias = entry.keystoreAlias
            ?: throw IllegalStateException("Key $keyId has no keystoreAlias")

        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
        keyStore.load(null)
        val privateKey = keyStore.getKey(alias, null)
            ?: throw IllegalStateException("Private key not found in keystore: $alias")

        val signature = Signature.getInstance(SIGNATURE_ALGORITHM)
        signature.initSign(privateKey as java.security.PrivateKey)

        val signedBytes = if (requireBiometric) {
            signWithBiometric(signature, data)
        } else {
            signature.update(data)
            signature.sign()
        }

        updateLastUsed(keyId)
        return signedBytes
    }

    override fun canSign(keyEntry: KeyEntry): Boolean {
        if (keyEntry.type != KeyType.ANDROID_KEYSTORE) return false
        val alias = keyEntry.keystoreAlias ?: return false
        return try {
            val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE)
            keyStore.load(null)
            keyStore.containsAlias(alias)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to check key availability: ${keyEntry.id}", e)
            false
        }
    }

    /**
     * Sign data using BiometricPrompt to authenticate the user.
     * Uses suspendCancellableCoroutine to bridge the callback-based BiometricPrompt API.
     */
    private suspend fun signWithBiometric(
        signature: Signature,
        data: ByteArray
    ): ByteArray = suspendCancellableCoroutine { cont ->
        val executor = ContextCompat.getMainExecutor(activity)
        val cryptoObject = BiometricPrompt.CryptoObject(signature)

        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                try {
                    val authedSignature = result.cryptoObject?.signature
                        ?: throw IllegalStateException("No signature in crypto object")
                    authedSignature.update(data)
                    val signed = authedSignature.sign()
                    cont.resume(signed)
                } catch (e: Exception) {
                    cont.resumeWithException(e)
                }
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                cont.resumeWithException(
                    BiometricAuthException(errorCode, errString.toString())
                )
            }

            override fun onAuthenticationFailed() {
                // Called on a single failed attempt (e.g., unrecognized fingerprint).
                // BiometricPrompt handles retry internally; no action needed here.
            }
        }

        val prompt = BiometricPrompt(activity, executor, callback)
        val promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("SSH Signing Request")
            .setDescription("Authenticate to sign with your app key")
            .setNegativeButtonText("Cancel")
            .build()

        // BiometricPrompt must be shown on the main thread
        activity.runOnUiThread {
            prompt.authenticate(promptInfo, cryptoObject)
        }

        cont.invokeOnCancellation {
            activity.runOnUiThread { prompt.cancelAuthentication() }
        }
    }

    private fun updateLastUsed(keyId: String) {
        try {
            registry.updateLastUsed(keyId, Instant.now().toString())
        } catch (e: Exception) {
            Log.w(TAG, "Failed to update lastUsedAt for key $keyId", e)
        }
    }
}

/**
 * Exception thrown when biometric authentication fails or is cancelled.
 */
class BiometricAuthException(
    val errorCode: Int,
    message: String
) : Exception("Biometric authentication failed (code $errorCode): $message")
