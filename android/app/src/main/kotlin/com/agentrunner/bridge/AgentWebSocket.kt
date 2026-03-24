package com.agentrunner.bridge

/**
 * Native WebSocket connection to agent-runner session endpoint for SSH agent messages.
 * Stub — implementation in T016.
 */
class AgentWebSocket(private val serverUrl: String) {
    var onSignRequest: ((SignRequest) -> Unit)? = null

    fun connect(sessionId: String) {
        TODO("T016: Implement WebSocket connection")
    }

    fun disconnect() {
        TODO("T016: Implement WebSocket disconnect")
    }

    fun sendResponse(requestId: String, data: ByteArray) {
        TODO("T016: Implement response sending")
    }

    fun sendCancel(requestId: String) {
        TODO("T016: Implement cancel sending")
    }
}
