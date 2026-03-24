package com.agentrunner.signing

import android.util.Log
import com.agentrunner.yubikey.YubikeyManager
import com.agentrunner.yubikey.YubikeyStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.Instant
import java.util.UUID

/**
 * SigningBackend implementation backed by a YubiKey via PIV slot 9a (ECDSA P-256).
 *
 * Wraps YubikeyManager for low-level PIV operations and integrates with KeyRegistry
 * to persist discovered keys. On YubiKey detection, reads the public key from slot 9a
 * and registers it in the KeyRegistry if not already present.
 *
 * PIN management: the underlying YubikeyManager caches the PIN after successful
 * verification. Use [signWithPin] for the first sign when no PIN is cached, and
 * [sign] for subsequent signs with the cached PIN. Use [hasCachedPin] to check.
 */
class YubikeySigningBackend(
    private val yubikey: YubikeyManager,
    private val registry: KeyRegistry
) : SigningBackend {

    companion object {
        private const val TAG = "YubikeySigningBackend"
        private const val PIV_SLOT = "9a"
        private const val KEY_COMMENT = "YubiKey PIV Slot 9a"
    }

    /**
     * List keys from the KeyRegistry that are of type YUBIKEY_PIV.
     *
     * This reads from the persistent registry rather than querying the hardware,
     * so it works even when the YubiKey is disconnected (keys will be listed but
     * [canSign] will return false).
     */
    override suspend fun listKeys(): List<KeyEntry> {
        return registry.listKeys().filter { it.type == KeyType.YUBIKEY_PIV }
    }

    /**
     * Sign data using the cached PIN from the underlying YubikeyManager.
     *
     * @throws IllegalArgumentException if keyId is not a YUBIKEY_PIV key in the registry
     * @throws IllegalStateException if no YubiKey is connected or no PIN is cached
     */
    override suspend fun sign(keyId: String, data: ByteArray): ByteArray {
        val entry = registry.getKey(keyId)
            ?: throw IllegalArgumentException("Key not found: $keyId")
        if (entry.type != KeyType.YUBIKEY_PIV) {
            throw IllegalArgumentException("Key $keyId is not a YubiKey PIV key")
        }

        val signature = yubikey.sign(data, null)
        updateLastUsed(keyId)
        return signature
    }

    /**
     * Sign data with an explicit PIN. Use this when [hasCachedPin] returns false.
     *
     * On successful PIN verification, the YubikeyManager caches the PIN for future
     * [sign] calls.
     *
     * @throws com.agentrunner.bridge.WrongPinException if PIN is incorrect
     * @throws com.agentrunner.bridge.PinBlockedException if PIN is blocked
     * @throws IllegalArgumentException if keyId is not a YUBIKEY_PIV key
     * @throws IllegalStateException if no YubiKey is connected
     */
    suspend fun signWithPin(keyId: String, data: ByteArray, pin: CharArray): ByteArray {
        val entry = registry.getKey(keyId)
            ?: throw IllegalArgumentException("Key not found: $keyId")
        if (entry.type != KeyType.YUBIKEY_PIV) {
            throw IllegalArgumentException("Key $keyId is not a YubiKey PIV key")
        }

        val signature = yubikey.sign(data, pin)
        updateLastUsed(keyId)
        return signature
    }

    override fun canSign(keyEntry: KeyEntry): Boolean {
        return keyEntry.type == KeyType.YUBIKEY_PIV &&
            yubikey.status.value != YubikeyStatus.DISCONNECTED &&
            yubikey.status.value != YubikeyStatus.ERROR
    }

    /**
     * Whether a PIN is currently cached for signing without user interaction.
     */
    fun hasCachedPin(): Boolean = yubikey.hasCachedPin()

    /**
     * Clear the cached PIN.
     */
    fun clearPin() = yubikey.clearPin()

    /**
     * Called when a YubiKey is detected (USB connected or NFC tapped).
     * Reads the public key from PIV slot 9a and registers it in the KeyRegistry
     * if not already present.
     */
    suspend fun onYubikeyConnected() {
        try {
            val sshKeys = yubikey.listKeys()
            for (sshKey in sshKeys) {
                val existing = registry.findByPublicKey(sshKey.blob)
                if (existing != null) {
                    Log.d(TAG, "Key already registered: ${existing.id}")
                    continue
                }

                val fingerprint = KeyRegistry.computeFingerprint(sshKey.blob)
                val entry = KeyEntry(
                    id = UUID.randomUUID().toString(),
                    name = KEY_COMMENT,
                    type = KeyType.YUBIKEY_PIV,
                    publicKey = sshKey.blob,
                    publicKeyComment = sshKey.comment,
                    fingerprint = fingerprint,
                    pivSlot = PIV_SLOT,
                    createdAt = Instant.now().toString()
                )
                registry.addKey(entry)
                Log.i(TAG, "Registered YubiKey: $fingerprint")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to register YubiKey keys", e)
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
