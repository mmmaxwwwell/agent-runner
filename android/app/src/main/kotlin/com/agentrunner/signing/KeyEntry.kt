package com.agentrunner.signing

/**
 * A registered signing key. Stored in keys.json via KeyRegistry.
 *
 * Each key has a type indicating which SigningBackend can use it.
 */
data class KeyEntry(
    val id: String,
    val name: String,
    val type: KeyType,
    val publicKey: ByteArray,
    val publicKeyComment: String,
    val fingerprint: String,
    val pivSlot: String? = null,
    val keystoreAlias: String? = null,
    val createdAt: String,
    val lastUsedAt: String? = null
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is KeyEntry) return false
        return id == other.id
    }

    override fun hashCode(): Int = id.hashCode()
}

enum class KeyType {
    YUBIKEY_PIV,
    ANDROID_KEYSTORE;

    fun toJsonValue(): String = when (this) {
        YUBIKEY_PIV -> "yubikey-piv"
        ANDROID_KEYSTORE -> "android-keystore"
    }

    companion object {
        fun fromJsonValue(value: String): KeyType = when (value) {
            "yubikey-piv" -> YUBIKEY_PIV
            "android-keystore" -> ANDROID_KEYSTORE
            else -> throw IllegalArgumentException("Unknown key type: $value")
        }
    }
}
