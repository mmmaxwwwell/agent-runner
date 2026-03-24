package com.agentrunner.bridge

import android.util.Log
import com.agentrunner.signing.KeyEntry
import com.agentrunner.signing.KeyRegistry
import com.agentrunner.signing.KeyType
import com.agentrunner.signing.SigningBackend
import com.agentrunner.signing.YubikeySigningBackend
import com.agentrunner.yubikey.YubikeyManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.util.Base64
import java.util.LinkedList

/**
 * Handles SSH agent sign requests from WebSocket, displays modal, drives Yubikey interaction.
 *
 * Processes requests one at a time via a queue. For messageType 11 (list keys), auto-responds
 * without showing a dialog. For messageType 13 (sign), shows the sign dialog and waits for
 * Yubikey touch to complete signing.
 */
class SignRequestHandler(
    private val yubikey: YubikeyManager,
    private val webSocket: AgentWebSocket,
    private val listener: SignRequestListener,
    private val scope: CoroutineScope,
    private val keyRegistry: KeyRegistry? = null,
    private val backends: List<SigningBackend> = emptyList()
) {
    companion object {
        private const val TAG = "SignRequestHandler"
        private const val SSH_AGENT_SIGN_RESPONSE: Byte = 14
        private const val SIGN_TIMEOUT_MS = 60_000L
    }

    private val requestQueue = LinkedList<SignRequest>()
    private var currentRequest: SignRequest? = null
    private var currentJob: Job? = null
    private var intentionallyCancelled = false
    private var processedCount = 0
    private var totalReceived = 0

    // Channel for receiving PIN from UI
    private val pinChannel = Channel<CharArray>(Channel.CONFLATED)

    // Currently selected key ID from the key picker (set by UI, consumed by backend routing)
    private var selectedKeyId: String? = null

    /**
     * Queue an incoming sign request. If no request is currently being processed,
     * starts processing immediately.
     */
    fun onSignRequest(request: SignRequest) {
        requestQueue.add(request)
        totalReceived++
        if (currentRequest == null) {
            processNext()
        } else {
            // Update badge on existing dialog to reflect new queue size
            val total = totalReceived - processedCount
            val position = 1 // current request is always position 1
            listener.onQueueUpdated(position, total)
        }
    }

    /**
     * Called when the user selects a key in the key picker.
     * Stores the key ID for backend routing when the sign is performed.
     */
    fun onKeySelected(keyId: String) {
        selectedKeyId = keyId
        Log.d(TAG, "Key selected: $keyId")
    }

    /**
     * Called when the user enters a PIN in the sign dialog.
     */
    fun onPinEntered(pin: CharArray) {
        pinChannel.trySend(pin)
    }

    /**
     * Called when the user cancels the current sign request.
     */
    fun onCancel() {
        val request = currentRequest ?: return
        intentionallyCancelled = true
        currentJob?.cancel()
        webSocket.sendCancel(request.requestId)
        listener.onDismissDialog()
        finishCurrent()
    }

    /**
     * Cancel all pending and current sign requests (e.g., on WebSocket disconnect).
     * Sends cancel for the current request and drops all queued requests.
     */
    fun cancelAll() {
        val request = currentRequest
        if (request != null) {
            intentionallyCancelled = true
            currentJob?.cancel()
            webSocket.sendCancel(request.requestId)
            listener.onDismissDialog()
        }
        // Cancel all queued requests
        while (requestQueue.isNotEmpty()) {
            val queued = requestQueue.poll()!!
            webSocket.sendCancel(queued.requestId)
        }
        currentRequest = null
        currentJob = null
        processedCount = 0
        totalReceived = 0
    }

    /**
     * Called when the Yubikey is disconnected during an active sign operation.
     */
    fun onYubikeyDisconnected() {
        val request = currentRequest ?: return
        intentionallyCancelled = true
        currentJob?.cancel()
        webSocket.sendCancel(request.requestId)
        listener.onSignError("Yubikey disconnected during signing. Request cancelled.")
        listener.onDismissDialog()
        finishCurrent()
    }

    private fun processNext() {
        val request = requestQueue.poll() ?: return
        currentRequest = request

        when (request.messageType) {
            11 -> processListKeys(request)
            13 -> processSign(request)
            else -> {
                Log.w(TAG, "Unknown messageType ${request.messageType}, skipping")
                finishCurrent()
            }
        }
    }

    private fun processListKeys(request: SignRequest) {
        currentJob = scope.launch {
            try {
                val out = ByteArrayOutputStream()
                out.write(12) // SSH_AGENT_IDENTITIES_ANSWER

                if (keyRegistry != null && backends.isNotEmpty()) {
                    // New path: query KeyRegistry for all keys, filter to currently-available
                    // per FR-100: app keys always available, Yubikey keys only when connected
                    val allKeys = keyRegistry.listKeys()
                    val availableKeys = allKeys.filter { entry ->
                        backends.any { backend -> backend.canSign(entry) }
                    }
                    out.writeUint32(availableKeys.size)
                    for (entry in availableKeys) {
                        out.writeSshString(entry.publicKey)
                        out.writeSshString(entry.publicKeyComment.toByteArray())
                    }
                } else {
                    // Legacy path: direct YubikeyManager query
                    val keys = yubikey.listKeys()
                    out.writeUint32(keys.size)
                    for (key in keys) {
                        out.writeSshString(key.blob)
                        out.writeSshString(key.comment.toByteArray())
                    }
                }

                webSocket.sendResponse(request.requestId, out.toByteArray())
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                Log.e(TAG, "Failed to list keys", e)
                webSocket.sendCancel(request.requestId)
            } finally {
                finishCurrent()
            }
        }
    }

    private fun processSign(request: SignRequest) {
        val total = totalReceived - processedCount
        val position = 1 // current is always position 1
        intentionallyCancelled = false

        if (keyRegistry != null && backends.isNotEmpty()) {
            // New path: parse key blob from SSH agent data, look up in KeyRegistry, route to backend
            val parsed = parseSignRequestData(request.data)
            if (parsed == null) {
                Log.e(TAG, "Failed to parse SSH agent sign request data")
                webSocket.sendCancel(request.requestId)
                finishCurrent()
                return
            }

            val keyEntry = keyRegistry.findByPublicKey(parsed.keyBlob)
            val matchingKeys = if (keyEntry != null) {
                val available = backends.any { it.canSign(keyEntry) }
                listOf(SignRequestDialog.MatchingKey(keyEntry, available))
            } else {
                // Key not in registry — check all keys for any that might match
                val allKeys = keyRegistry.listKeys()
                allKeys.map { entry ->
                    SignRequestDialog.MatchingKey(entry, backends.any { it.canSign(entry) })
                }
            }

            val pinRequired = keyEntry?.type == KeyType.YUBIKEY_PIV &&
                backends.filterIsInstance<YubikeySigningBackend>().any { !it.hasCachedPin() }

            listener.onShowSignDialog(request, pinRequired, position, total, matchingKeys)

            currentJob = scope.launch {
                try {
                    withTimeout(SIGN_TIMEOUT_MS) {
                        performSignWithBackend(request, parsed.dataToSign, keyEntry, pinRequired)
                    }
                } catch (e: CancellationException) {
                    if (!intentionallyCancelled) {
                        webSocket.sendCancel(request.requestId)
                        listener.onDismissDialog()
                        finishCurrent()
                    }
                } catch (e: IOException) {
                    Log.e(TAG, "Connection lost during signing", e)
                    webSocket.sendCancel(request.requestId)
                    listener.onSignError("Connection lost during signing. Request cancelled.")
                    listener.onDismissDialog()
                    finishCurrent()
                }
            }
        } else {
            // Legacy path: direct Yubikey signing
            val pinRequired = !yubikey.hasCachedPin()
            listener.onShowSignDialog(request, pinRequired, position, total)

            currentJob = scope.launch {
                try {
                    withTimeout(SIGN_TIMEOUT_MS) {
                        if (pinRequired) {
                            signWithPinLoop(request)
                        } else {
                            performSign(request, null)
                        }
                    }
                } catch (e: CancellationException) {
                    if (!intentionallyCancelled) {
                        webSocket.sendCancel(request.requestId)
                        listener.onDismissDialog()
                        finishCurrent()
                    }
                } catch (e: IOException) {
                    Log.e(TAG, "Yubikey connection lost during signing", e)
                    webSocket.sendCancel(request.requestId)
                    listener.onSignError("Yubikey disconnected during signing. Request cancelled.")
                    listener.onDismissDialog()
                    finishCurrent()
                }
            }
        }
    }

    /**
     * New backend-routed sign flow. Resolves the target key (from key picker selection or
     * the matched key entry), finds the appropriate backend, and signs.
     */
    private suspend fun performSignWithBackend(
        request: SignRequest,
        dataToSign: ByteArray,
        matchedKeyEntry: KeyEntry?,
        pinRequired: Boolean
    ) {
        // Determine which key to use: prefer user selection from picker, fall back to matched key
        val targetKeyId = selectedKeyId ?: matchedKeyEntry?.id
        if (targetKeyId == null) {
            Log.e(TAG, "No key selected and no matching key found for sign request")
            webSocket.sendCancel(request.requestId)
            listener.onSignError("No matching key found for this sign request.")
            listener.onDismissDialog()
            finishCurrent()
            return
        }

        val keyEntry = keyRegistry!!.getKey(targetKeyId)
        if (keyEntry == null) {
            Log.e(TAG, "Selected key $targetKeyId not found in registry")
            webSocket.sendCancel(request.requestId)
            listener.onSignError("Selected key not found.")
            listener.onDismissDialog()
            finishCurrent()
            return
        }

        val backend = backends.find { it.canSign(keyEntry) }
        if (backend == null) {
            Log.e(TAG, "No available backend for key $targetKeyId (type=${keyEntry.type})")
            webSocket.sendCancel(request.requestId)
            listener.onSignError("Key is not currently available for signing.")
            listener.onDismissDialog()
            finishCurrent()
            return
        }

        try {
            val signature = when {
                // Yubikey: may need PIN
                keyEntry.type == KeyType.YUBIKEY_PIV && backend is YubikeySigningBackend -> {
                    if (pinRequired) {
                        signWithPinLoopBackend(backend, targetKeyId, dataToSign)
                    } else {
                        backend.sign(targetKeyId, dataToSign)
                    }
                }
                // Keystore/Mock: sign directly (biometric handled internally by backend)
                else -> backend.sign(targetKeyId, dataToSign)
            }

            val signatureBlob = buildSignatureBlob(signature)
            val response = ByteArrayOutputStream()
            response.write(SSH_AGENT_SIGN_RESPONSE.toInt())
            response.writeSshString(signatureBlob)

            webSocket.sendResponse(request.requestId, response.toByteArray())
            listener.onDismissDialog()
            finishCurrent()
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Signing failed", e)
            webSocket.sendCancel(request.requestId)
            listener.onSignError("Signing failed: ${e.message}")
            listener.onDismissDialog()
            finishCurrent()
        } finally {
            selectedKeyId = null
        }
    }

    /**
     * PIN entry loop for Yubikey signing via the new backend interface.
     */
    private suspend fun signWithPinLoopBackend(
        backend: YubikeySigningBackend,
        keyId: String,
        dataToSign: ByteArray
    ): ByteArray {
        while (true) {
            val pin = pinChannel.receive()
            try {
                return backend.signWithPin(keyId, dataToSign, pin)
            } catch (e: WrongPinException) {
                listener.onPinError(e.message ?: "Wrong PIN", e.retriesRemaining)
            } catch (e: PinBlockedException) {
                listener.onPinBlocked(e.message ?: "PIN is blocked")
                throw e
            }
        }
    }

    private suspend fun signWithPinLoop(request: SignRequest) {
        while (true) {
            val pin = pinChannel.receive()
            try {
                performSign(request, pin)
                return
            } catch (e: WrongPinException) {
                listener.onPinError(e.message ?: "Wrong PIN", e.retriesRemaining)
                // Loop continues — user can retry
            } catch (e: PinBlockedException) {
                listener.onPinBlocked(e.message ?: "PIN is blocked")
                webSocket.sendCancel(request.requestId)
                listener.onDismissDialog()
                finishCurrent()
                return
            } catch (e: IOException) {
                // Yubikey disconnected while signing with PIN — rethrow to processSign handler
                throw e
            }
        }
    }

    private suspend fun performSign(request: SignRequest, pin: CharArray?) {
        val dataToSign = Base64.getDecoder().decode(request.data)

        val signature = yubikey.sign(dataToSign, pin)

        // Build SSH_AGENT_SIGN_RESPONSE (type 14): byte 14 + string signature_blob
        // signature_blob = string "ecdsa-sha2-nistp256" + string signature
        val signatureBlob = buildSignatureBlob(signature)
        val response = ByteArrayOutputStream()
        response.write(SSH_AGENT_SIGN_RESPONSE.toInt())
        response.writeSshString(signatureBlob)

        webSocket.sendResponse(request.requestId, response.toByteArray())
        listener.onDismissDialog()
        finishCurrent()
    }

    private fun buildSignatureBlob(derSignature: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        out.writeSshString("ecdsa-sha2-nistp256".toByteArray())
        out.writeSshString(derSignature)
        return out.toByteArray()
    }

    private fun finishCurrent() {
        currentRequest = null
        currentJob = null
        processedCount++
        // Reset counters when queue is drained
        if (requestQueue.isEmpty()) {
            processedCount = 0
            totalReceived = 0
        }
        processNext()
    }

    private fun ByteArrayOutputStream.writeUint32(value: Int) {
        val buf = ByteBuffer.allocate(4)
        buf.putInt(value)
        write(buf.array())
    }

    private fun ByteArrayOutputStream.writeSshString(data: ByteArray) {
        writeUint32(data.size)
        write(data)
    }

    /**
     * Parsed components of an SSH agent sign request (messageType 13).
     */
    private data class ParsedSignRequest(
        val keyBlob: ByteArray,
        val dataToSign: ByteArray,
        val flags: Int
    )

    /**
     * Parse the base64-encoded SSH agent sign request data.
     * Format: byte(13) + string(key_blob) + string(data) + uint32(flags)
     * where string = uint32(length) + bytes.
     */
    private fun parseSignRequestData(base64Data: String): ParsedSignRequest? {
        return try {
            val raw = Base64.getDecoder().decode(base64Data)
            val buf = ByteBuffer.wrap(raw)

            // Skip type byte (13)
            if (buf.remaining() < 1) return null
            buf.get()

            // Read key_blob: uint32 length + bytes
            if (buf.remaining() < 4) return null
            val keyBlobLen = buf.int
            if (keyBlobLen < 0 || buf.remaining() < keyBlobLen) return null
            val keyBlob = ByteArray(keyBlobLen)
            buf.get(keyBlob)

            // Read data: uint32 length + bytes
            if (buf.remaining() < 4) return null
            val dataLen = buf.int
            if (dataLen < 0 || buf.remaining() < dataLen) return null
            val dataToSign = ByteArray(dataLen)
            buf.get(dataToSign)

            // Read flags
            val flags = if (buf.remaining() >= 4) buf.int else 0

            ParsedSignRequest(keyBlob, dataToSign, flags)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse sign request data", e)
            null
        }
    }
}
