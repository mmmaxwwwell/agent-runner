package com.agentrunner.bridge

/**
 * Represents an SSH agent request received over WebSocket.
 *
 * @param requestId Unique identifier for correlating response/cancel
 * @param messageType SSH agent message type (11 = list keys, 13 = sign)
 * @param context Human-readable description of the operation
 * @param data Base64-encoded SSH agent message payload
 */
data class SignRequest(
    val requestId: String,
    val messageType: Int,
    val context: String,
    val data: String
)
