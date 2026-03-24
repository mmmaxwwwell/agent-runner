package com.agentrunner.signing

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * Persistent registry of signing keys. Reads/writes keys.json in app-private storage.
 *
 * Thread-safety: all mutating operations are synchronized on the registry instance.
 */
class KeyRegistry(private val context: Context) {

    private val file: File
        get() = File(context.filesDir, FILENAME)

    // --- Read ---

    fun listKeys(): List<KeyEntry> {
        val f = file
        if (!f.exists()) return emptyList()
        val json = JSONArray(f.readText())
        return (0 until json.length()).map { i -> fromJson(json.getJSONObject(i)) }
    }

    fun getKey(id: String): KeyEntry? = listKeys().find { it.id == id }

    fun findByPublicKey(publicKeyBlob: ByteArray): KeyEntry? =
        listKeys().find { it.publicKey.contentEquals(publicKeyBlob) }

    fun findByFingerprint(fingerprint: String): KeyEntry? =
        listKeys().find { it.fingerprint == fingerprint }

    // --- Write ---

    @Synchronized
    fun addKey(entry: KeyEntry) {
        val keys = listKeys().toMutableList()
        if (keys.any { it.id == entry.id }) {
            throw IllegalArgumentException("Key with id ${entry.id} already exists")
        }
        if (keys.any { it.publicKey.contentEquals(entry.publicKey) }) {
            throw IllegalArgumentException("Key with same public key already registered")
        }
        keys.add(entry)
        save(keys)
    }

    @Synchronized
    fun updateKey(id: String, transform: (KeyEntry) -> KeyEntry) {
        val keys = listKeys().toMutableList()
        val idx = keys.indexOfFirst { it.id == id }
        if (idx == -1) throw IllegalArgumentException("Key not found: $id")
        keys[idx] = transform(keys[idx])
        save(keys)
    }

    @Synchronized
    fun removeKey(id: String): Boolean {
        val keys = listKeys().toMutableList()
        val removed = keys.removeAll { it.id == id }
        if (removed) save(keys)
        return removed
    }

    @Synchronized
    fun updateLastUsed(id: String, timestamp: String) {
        updateKey(id) { it.copy(lastUsedAt = timestamp) }
    }

    // --- Export ---

    /**
     * Export a key's public key in SSH authorized_keys format.
     * Format: `ecdsa-sha2-nistp256 <base64-blob> <comment>`
     */
    fun exportAuthorizedKey(entry: KeyEntry): String {
        val blob = entry.publicKey
        val b64 = Base64.encodeToString(blob, Base64.NO_WRAP)
        return "ecdsa-sha2-nistp256 $b64 ${entry.publicKeyComment}"
    }

    // --- Fingerprint ---

    companion object {
        private const val FILENAME = "keys.json"

        /**
         * Compute SSH SHA256 fingerprint from a public key blob.
         * Returns `SHA256:<base64-hash>` (no padding).
         */
        fun computeFingerprint(publicKeyBlob: ByteArray): String {
            val digest = MessageDigest.getInstance("SHA-256").digest(publicKeyBlob)
            val b64 = Base64.encodeToString(digest, Base64.NO_WRAP or Base64.NO_PADDING)
            return "SHA256:$b64"
        }
    }

    // --- JSON serialization ---

    private fun save(keys: List<KeyEntry>) {
        val arr = JSONArray()
        keys.forEach { arr.put(toJson(it)) }
        file.writeText(arr.toString(2))
    }

    private fun toJson(entry: KeyEntry): JSONObject = JSONObject().apply {
        put("id", entry.id)
        put("name", entry.name)
        put("type", entry.type.toJsonValue())
        put("publicKey", Base64.encodeToString(entry.publicKey, Base64.NO_WRAP))
        put("publicKeyComment", entry.publicKeyComment)
        put("fingerprint", entry.fingerprint)
        put("pivSlot", entry.pivSlot ?: JSONObject.NULL)
        put("keystoreAlias", entry.keystoreAlias ?: JSONObject.NULL)
        put("createdAt", entry.createdAt)
        put("lastUsedAt", entry.lastUsedAt ?: JSONObject.NULL)
    }

    private fun fromJson(json: JSONObject): KeyEntry = KeyEntry(
        id = json.getString("id"),
        name = json.getString("name"),
        type = KeyType.fromJsonValue(json.getString("type")),
        publicKey = Base64.decode(json.getString("publicKey"), Base64.NO_WRAP),
        publicKeyComment = json.getString("publicKeyComment"),
        fingerprint = json.getString("fingerprint"),
        pivSlot = if (json.isNull("pivSlot")) null else json.getString("pivSlot"),
        keystoreAlias = if (json.isNull("keystoreAlias")) null else json.getString("keystoreAlias"),
        createdAt = json.getString("createdAt"),
        lastUsedAt = if (json.isNull("lastUsedAt")) null else json.getString("lastUsedAt")
    )
}
