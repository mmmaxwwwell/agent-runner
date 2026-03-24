package com.agentrunner.yubikey

/**
 * Manages Yubikey detection and PIV operations. Wraps YubiKitManager.
 * Stub — implementation in T014.
 */
open class YubikeyManager {
    open fun hasCachedPin(): Boolean {
        TODO("T014: Implement PIN cache check")
    }

    open suspend fun listKeys(): List<SshPublicKey> {
        TODO("T014: Implement key listing")
    }

    open suspend fun sign(data: ByteArray, pin: CharArray?): ByteArray {
        TODO("T014: Implement signing")
    }

    open fun clearPin() {
        TODO("T014: Implement PIN clearing")
    }
}
