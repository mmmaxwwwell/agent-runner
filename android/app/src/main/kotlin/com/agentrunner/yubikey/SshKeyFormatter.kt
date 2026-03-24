package com.agentrunner.yubikey

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.security.cert.X509Certificate
import java.security.interfaces.ECPublicKey

/**
 * Converts X509Certificate ECDSA P-256 public keys to SSH wire format.
 * Builds SSH_AGENT_IDENTITIES_ANSWER responses for the ssh-agent protocol.
 */
object SshKeyFormatter {

    private const val SSH_AGENT_IDENTITIES_ANSWER: Byte = 12
    private const val KEY_TYPE = "ecdsa-sha2-nistp256"
    private const val CURVE_NAME = "nistp256"
    private const val COORDINATE_SIZE = 32

    /**
     * Convert an X509Certificate's ECDSA P-256 public key to SSH wire format.
     * Output: SSH string "ecdsa-sha2-nistp256" + SSH string "nistp256" + SSH string EC_point
     */
    fun toSshPublicKeyBlob(cert: X509Certificate): ByteArray {
        val ecKey = cert.publicKey as ECPublicKey
        val w = ecKey.w

        // Build uncompressed EC point: 0x04 + 32-byte X + 32-byte Y
        val xBytes = bigIntToFixedBytes(w.affineX, COORDINATE_SIZE)
        val yBytes = bigIntToFixedBytes(w.affineY, COORDINATE_SIZE)
        val ecPoint = ByteArray(1 + COORDINATE_SIZE + COORDINATE_SIZE)
        ecPoint[0] = 0x04
        xBytes.copyInto(ecPoint, 1)
        yBytes.copyInto(ecPoint, 1 + COORDINATE_SIZE)

        val out = ByteArrayOutputStream()
        out.writeSshString(KEY_TYPE.toByteArray())
        out.writeSshString(CURVE_NAME.toByteArray())
        out.writeSshString(ecPoint)
        return out.toByteArray()
    }

    /**
     * Build an SSH_AGENT_IDENTITIES_ANSWER message containing one key.
     * Output: byte 12 + uint32 nkeys=1 + SSH string key_blob + SSH string comment
     */
    fun buildIdentitiesAnswer(cert: X509Certificate, comment: String): ByteArray {
        val keyBlob = toSshPublicKeyBlob(cert)
        val out = ByteArrayOutputStream()
        out.write(SSH_AGENT_IDENTITIES_ANSWER.toInt())
        out.writeUint32(1)
        out.writeSshString(keyBlob)
        out.writeSshString(comment.toByteArray())
        return out.toByteArray()
    }

    /** Convert a BigInteger to a fixed-size unsigned byte array, zero-padded on the left. */
    private fun bigIntToFixedBytes(value: java.math.BigInteger, size: Int): ByteArray {
        val raw = value.toByteArray()
        return when {
            raw.size == size -> raw
            raw.size > size -> {
                // BigInteger may prepend a 0x00 sign byte — strip leading zeros
                val offset = raw.size - size
                raw.copyOfRange(offset, raw.size)
            }
            else -> {
                // Pad with leading zeros
                val padded = ByteArray(size)
                raw.copyInto(padded, size - raw.size)
                padded
            }
        }
    }

    /** Write a uint32 (big-endian) to the stream. */
    private fun ByteArrayOutputStream.writeUint32(value: Int) {
        val buf = ByteBuffer.allocate(4)
        buf.putInt(value)
        write(buf.array())
    }

    /** Write an SSH string (uint32 length prefix + data) to the stream. */
    private fun ByteArrayOutputStream.writeSshString(data: ByteArray) {
        writeUint32(data.size)
        write(data)
    }
}
