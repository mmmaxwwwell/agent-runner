package com.agentrunner.yubikey

/**
 * Connection state of a Yubikey device.
 */
enum class YubikeyStatus {
    DISCONNECTED,
    CONNECTED_USB,
    CONNECTED_NFC,
    ERROR
}
