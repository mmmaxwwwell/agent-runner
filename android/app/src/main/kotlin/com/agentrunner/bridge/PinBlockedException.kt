package com.agentrunner.bridge

/**
 * Thrown when the PIV PIN is blocked (0 retries remaining, SW 0x6983).
 * Recovery requires PUK unblock via `ykman piv access unblock-pin`.
 */
class PinBlockedException(message: String) : Exception(message)
