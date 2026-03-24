package com.agentrunner.helpers

import androidx.fragment.app.FragmentActivity
import com.agentrunner.signing.BiometricAuthenticator
import java.security.Signature

/**
 * Auto-succeeding [BiometricAuthenticator] for unattended instrumented testing (FR-110).
 *
 * Instead of showing a real BiometricPrompt dialog and waiting for user interaction,
 * this immediately calls [Signature.update]/[Signature.sign] and returns the result.
 * The cryptographic signing still occurs — only the biometric authentication gate is bypassed.
 *
 * Usage:
 * ```
 * val backend = KeystoreSigningBackend(
 *     activity = activity,
 *     registry = registry,
 *     requireBiometric = true,
 *     biometricAuthenticator = MockBiometricPrompt()
 * )
 * // sign() calls will auto-succeed without showing biometric UI
 * ```
 */
class MockBiometricPrompt : BiometricAuthenticator {

    /** Count of how many times authenticateAndSign was called (for test assertions). */
    var authenticationCount: Int = 0
        private set

    override suspend fun authenticateAndSign(
        activity: FragmentActivity,
        signature: Signature,
        data: ByteArray
    ): ByteArray {
        authenticationCount++
        // Skip biometric — just sign directly with the already-initialized Signature
        signature.update(data)
        return signature.sign()
    }
}
