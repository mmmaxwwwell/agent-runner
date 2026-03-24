package com.agentrunner.signing

/**
 * Interface for signing backends that can list keys and sign data.
 *
 * Implementations:
 * - YubikeySigningBackend: PIV signing via yubikit-android (requires hardware)
 * - KeystoreSigningBackend: Android Keystore ECDSA P-256 (requires biometric auth)
 * - MockSigningBackend: Debug/test builds, auto-signs with test keypair
 *
 * SignRequestHandler routes sign requests by looking up the requested key blob
 * in KeyRegistry and dispatching to the backend matching KeyEntry.type.
 */
interface SigningBackend {

    /**
     * List all keys currently available from this backend.
     *
     * For hardware backends (Yubikey), this requires a connected device.
     * For software backends (Keystore, Mock), keys are always available.
     *
     * @return list of key entries this backend can sign with
     */
    suspend fun listKeys(): List<KeyEntry>

    /**
     * Sign data using the specified key.
     *
     * @param keyId the KeyEntry.id identifying which key to use
     * @param data raw data to sign (typically an SSH signing challenge)
     * @return the signature bytes (DER-encoded ECDSA for P-256 keys)
     * @throws IllegalArgumentException if keyId is not known to this backend
     * @throws IllegalStateException if the backend is not ready (e.g., Yubikey disconnected)
     */
    suspend fun sign(keyId: String, data: ByteArray): ByteArray

    /**
     * Whether this backend can sign with the given key entry.
     *
     * Used by SignRequestHandler to route sign requests to the correct backend.
     * Checks both key type compatibility and current availability
     * (e.g., Yubikey must be connected).
     *
     * @param keyEntry the key to check
     * @return true if this backend can currently fulfill a sign request for this key
     */
    fun canSign(keyEntry: KeyEntry): Boolean
}
