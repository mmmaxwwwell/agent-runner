package com.agentrunner.yubikey

import java.security.cert.X509Certificate

/**
 * Converts X509Certificate ECDSA P-256 public keys to SSH wire format.
 * Stub — full implementation in T015.
 */
object SshKeyFormatter {

    fun toSshPublicKeyBlob(cert: X509Certificate): ByteArray {
        TODO("T015: Implement SSH public key blob encoding")
    }

    fun buildIdentitiesAnswer(cert: X509Certificate, comment: String): ByteArray {
        TODO("T015: Implement SSH_AGENT_IDENTITIES_ANSWER building")
    }
}
