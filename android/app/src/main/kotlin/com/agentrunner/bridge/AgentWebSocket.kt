package com.agentrunner.bridge

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.Base64
import java.util.concurrent.TimeUnit

/**
 * Native WebSocket connection to agent-runner session endpoint for SSH agent messages.
 * Connects to ws://<serverUrl>/ws/sessions/<sessionId> and filters for ssh-agent-request messages.
 * Handles reconnection with exponential backoff.
 */
class AgentWebSocket(private val serverUrl: String) {

    companion object {
        private const val TAG = "AgentWebSocket"
        private const val NORMAL_CLOSURE = 1000
        private const val INITIAL_BACKOFF_MS = 1000L
        private const val MAX_BACKOFF_MS = 30000L
    }

    var onSignRequest: ((SignRequest) -> Unit)? = null
    var onDisconnect: (() -> Unit)? = null

    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS) // No read timeout for WebSocket
        .build()

    private var webSocket: WebSocket? = null
    private var sessionId: String? = null
    private var intentionalDisconnect = false
    private var backoffMs = INITIAL_BACKOFF_MS
    private var reconnectThread: Thread? = null

    fun connect(sessionId: String) {
        this.sessionId = sessionId
        intentionalDisconnect = false
        backoffMs = INITIAL_BACKOFF_MS
        openConnection(sessionId)
    }

    fun disconnect() {
        intentionalDisconnect = true
        reconnectThread?.interrupt()
        reconnectThread = null
        webSocket?.close(NORMAL_CLOSURE, "Client disconnecting")
        webSocket = null
        sessionId = null
    }

    fun sendResponse(requestId: String, data: ByteArray) {
        val json = JSONObject().apply {
            put("type", "ssh-agent-response")
            put("requestId", requestId)
            put("data", Base64.getEncoder().encodeToString(data))
        }
        val sent = webSocket?.send(json.toString()) ?: false
        if (!sent) {
            Log.w(TAG, "Failed to send ssh-agent-response for $requestId")
        }
    }

    fun sendCancel(requestId: String) {
        val json = JSONObject().apply {
            put("type", "ssh-agent-cancel")
            put("requestId", requestId)
        }
        val sent = webSocket?.send(json.toString()) ?: false
        if (!sent) {
            Log.w(TAG, "Failed to send ssh-agent-cancel for $requestId")
        }
    }

    private fun openConnection(sessionId: String) {
        val wsUrl = buildWsUrl(sessionId)
        Log.d(TAG, "Connecting to $wsUrl")

        val request = Request.Builder()
            .url(wsUrl)
            .build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "WebSocket connected to session $sessionId")
                backoffMs = INITIAL_BACKOFF_MS
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    val type = json.optString("type")
                    if (type == "ssh-agent-request") {
                        val signRequest = SignRequest(
                            requestId = json.getString("requestId"),
                            messageType = json.getInt("messageType"),
                            context = json.optString("context", ""),
                            data = json.getString("data")
                        )
                        Log.d(TAG, "Received ssh-agent-request: ${signRequest.requestId} type=${signRequest.messageType}")
                        onSignRequest?.invoke(signRequest)
                    }
                } catch (e: Exception) {
                    Log.d(TAG, "Ignoring unparseable WebSocket message: ${e.message}")
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closing: $code $reason")
                webSocket.close(NORMAL_CLOSURE, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closed: $code $reason")
                if (!intentionalDisconnect) {
                    onDisconnect?.invoke()
                }
                scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "WebSocket failure: ${t.message}")
                if (!intentionalDisconnect) {
                    onDisconnect?.invoke()
                }
                scheduleReconnect()
            }
        })
    }

    private fun buildWsUrl(sessionId: String): String {
        val base = serverUrl.trimEnd('/')
        val wsBase = when {
            base.startsWith("https://") -> "wss://" + base.removePrefix("https://")
            base.startsWith("http://") -> "ws://" + base.removePrefix("http://")
            else -> "ws://$base"
        }
        return "$wsBase/ws/sessions/$sessionId"
    }

    private fun scheduleReconnect() {
        if (intentionalDisconnect) return
        val sid = sessionId ?: return

        Log.d(TAG, "Reconnecting in ${backoffMs}ms")
        reconnectThread = Thread {
            try {
                Thread.sleep(backoffMs)
                if (!intentionalDisconnect && sessionId != null) {
                    backoffMs = (backoffMs * 2).coerceAtMost(MAX_BACKOFF_MS)
                    openConnection(sid)
                }
            } catch (_: InterruptedException) {
                // Disconnect was called, stop reconnecting
            }
        }.also { it.start() }
    }
}
