package com.agentrunner.bridge

/**
 * Callback interface for SignRequestHandler to communicate UI events.
 * Implemented by the activity/fragment hosting the sign dialog.
 */
interface SignRequestListener {
    /** Show the sign request dialog. [pinRequired] indicates whether PIN input field should be visible. */
    fun onShowSignDialog(request: SignRequest, pinRequired: Boolean)

    /** Dismiss the currently visible sign dialog. */
    fun onDismissDialog()

    /** Show PIN verification error with remaining retry count. */
    fun onPinError(message: String, retriesRemaining: Int)

    /** Show PIN blocked error (key is locked, requires PUK unblock). */
    fun onPinBlocked(message: String)

    /** Show a general signing error. */
    fun onSignError(message: String)
}
