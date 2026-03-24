package com.agentrunner.bridge

import android.util.Log
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
    private val scope: CoroutineScope
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

    // Currently selected key ID from the key picker (set by UI, consumed by T028's backend routing)
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
                val keys = yubikey.listKeys()
                // Build SSH_AGENT_IDENTITIES_ANSWER: byte 12 + uint32 nkeys + (string blob + string comment)*
                val out = ByteArrayOutputStream()
                out.write(12) // SSH_AGENT_IDENTITIES_ANSWER
                out.writeUint32(keys.size)
                for (key in keys) {
                    out.writeSshString(key.blob)
                    out.writeSshString(key.comment.toByteArray())
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
        val pinRequired = !yubikey.hasCachedPin()
        val total = totalReceived - processedCount
        val position = 1 // current is always position 1
        listener.onShowSignDialog(request, pinRequired, position, total)
        intentionallyCancelled = false

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
                    // Timeout — not cancelled by onCancel/onYubikeyDisconnected
                    webSocket.sendCancel(request.requestId)
                    listener.onDismissDialog()
                    finishCurrent()
                }
            } catch (e: IOException) {
                // Connection lost (USB yanked or NFC field lost during sign)
                Log.e(TAG, "Yubikey connection lost during signing", e)
                webSocket.sendCancel(request.requestId)
                listener.onSignError("Yubikey disconnected during signing. Request cancelled.")
                listener.onDismissDialog()
                finishCurrent()
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
}
