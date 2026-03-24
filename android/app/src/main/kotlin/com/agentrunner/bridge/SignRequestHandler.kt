package com.agentrunner.bridge

import com.agentrunner.yubikey.YubikeyManager
import kotlinx.coroutines.CoroutineScope

/**
 * Handles SSH agent sign requests from WebSocket, displays modal, drives Yubikey interaction.
 * Stub — implementation in T017.
 */
class SignRequestHandler(
    private val yubikey: YubikeyManager,
    private val webSocket: AgentWebSocket,
    private val listener: SignRequestListener,
    private val scope: CoroutineScope
) {
    fun onSignRequest(request: SignRequest) {
        TODO("T017: Implement sign request handling")
    }

    fun onPinEntered(pin: CharArray) {
        TODO("T017: Implement PIN entry handling")
    }

    fun onCancel() {
        TODO("T017: Implement cancel handling")
    }

    fun onYubikeyDisconnected() {
        TODO("T017: Implement Yubikey disconnect handling")
    }
}
