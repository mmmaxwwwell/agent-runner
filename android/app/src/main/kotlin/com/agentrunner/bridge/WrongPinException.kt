package com.agentrunner.bridge

/**
 * Thrown when PIV PIN verification fails.
 * @param retriesRemaining Number of PIN attempts remaining before lockout.
 */
class WrongPinException(val retriesRemaining: Int) : Exception(
    "Wrong PIN. $retriesRemaining retries remaining."
)
