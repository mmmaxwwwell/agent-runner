package com.agentrunner.bridge

/**
 * Callback interface for SignRequestHandler to communicate UI events.
 * Implemented by the activity/fragment hosting the sign dialog.
 */
interface SignRequestListener {
    /** Show the sign request dialog. [pinRequired] indicates whether PIN input field should be visible. [queuePosition] is 1-based, [queueTotal] is total pending+current. [matchingKeys] lists keys that can fulfill this request with availability status. */
    fun onShowSignDialog(request: SignRequest, pinRequired: Boolean, queuePosition: Int = 1, queueTotal: Int = 1, matchingKeys: List<SignRequestDialog.MatchingKey> = emptyList())

    /** Update the queue badge on the current dialog (e.g., "Request 2 of 3"). */
    fun onQueueUpdated(queuePosition: Int, queueTotal: Int)

    /** Dismiss the currently visible sign dialog. */
    fun onDismissDialog()

    /** Show PIN verification error with remaining retry count. */
    fun onPinError(message: String, retriesRemaining: Int)

    /** Show PIN blocked error (key is locked, requires PUK unblock). */
    fun onPinBlocked(message: String)

    /** Show a general signing error. */
    fun onSignError(message: String)

    /** Update matching key availability in the dialog (e.g., when Yubikey connects/disconnects). */
    fun onUpdateMatchingKeys(matchingKeys: List<SignRequestDialog.MatchingKey>)
}
