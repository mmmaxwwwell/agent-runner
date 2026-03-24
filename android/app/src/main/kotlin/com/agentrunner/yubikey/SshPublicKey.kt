package com.agentrunner.yubikey

/**
 * SSH public key in wire format with a human-readable comment.
 */
data class SshPublicKey(
    val blob: ByteArray,
    val comment: String
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is SshPublicKey) return false
        return blob.contentEquals(other.blob) && comment == other.comment
    }

    override fun hashCode(): Int {
        return 31 * blob.contentHashCode() + comment.hashCode()
    }
}
