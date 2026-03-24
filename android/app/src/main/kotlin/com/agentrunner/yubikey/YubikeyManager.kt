package com.agentrunner.yubikey

import android.app.Activity
import android.content.Context
import android.util.Log
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import com.agentrunner.bridge.PinBlockedException
import com.agentrunner.bridge.WrongPinException
import com.yubico.yubikit.android.YubiKitManager
import com.yubico.yubikit.android.transport.nfc.NfcConfiguration
import com.yubico.yubikit.android.transport.nfc.NfcNotAvailable
import com.yubico.yubikit.android.transport.nfc.NfcYubiKeyDevice
import com.yubico.yubikit.android.transport.usb.UsbConfiguration
import com.yubico.yubikit.android.transport.usb.UsbYubiKeyDevice
import com.yubico.yubikit.core.smartcard.ApduException
import com.yubico.yubikit.core.smartcard.SmartCardConnection
import com.yubico.yubikit.piv.KeyType
import com.yubico.yubikit.piv.PivSession
import com.yubico.yubikit.piv.Slot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.security.cert.X509Certificate

/**
 * Manages Yubikey detection and PIV operations. Wraps YubiKitManager.
 *
 * Handles USB and NFC discovery, PIN caching, key listing (slot 9a),
 * and ECDSA P-256 signing via PIV rawSignOrDecrypt.
 */
open class YubikeyManager(context: Context) {

    companion object {
        private const val TAG = "YubikeyManager"
        private const val SW_PIN_BLOCKED: Short = 0x6983.toShort()
    }

    private val yubiKitManager = YubiKitManager(context.applicationContext)

    private val _status = MutableLiveData(YubikeyStatus.DISCONNECTED)
    val status: LiveData<YubikeyStatus> get() = _status

    private var usbDevice: UsbYubiKeyDevice? = null
    private var nfcDevice: NfcYubiKeyDevice? = null

    // PIN cached as char array in memory — never persisted to disk, zeroed on destroy
    private var cachedPin: CharArray? = null

    /**
     * Start USB and NFC discovery. Call from Activity.onResume().
     */
    fun startDiscovery(activity: Activity) {
        yubiKitManager.startUsbDiscovery(UsbConfiguration()) { device ->
            Log.i(TAG, "USB Yubikey connected")
            usbDevice = device
            _status.postValue(YubikeyStatus.CONNECTED_USB)
            device.setOnClosed {
                Log.i(TAG, "USB Yubikey disconnected")
                usbDevice = null
                _status.postValue(YubikeyStatus.DISCONNECTED)
            }
        }

        try {
            yubiKitManager.startNfcDiscovery(
                NfcConfiguration(),
                activity
            ) { device ->
                Log.i(TAG, "NFC Yubikey tapped")
                nfcDevice = device
                _status.postValue(YubikeyStatus.CONNECTED_NFC)
            }
        } catch (e: NfcNotAvailable) {
            Log.w(TAG, "NFC not available on this device", e)
        }
    }

    /**
     * Stop USB and NFC discovery. Call from Activity.onPause().
     */
    fun stopDiscovery(activity: Activity) {
        yubiKitManager.stopUsbDiscovery()
        yubiKitManager.stopNfcDiscovery(activity)
        nfcDevice = null
    }

    /**
     * Whether a PIN is currently cached in memory.
     */
    open fun hasCachedPin(): Boolean = cachedPin != null

    /**
     * List SSH public keys from PIV slot 9a (Authentication).
     * Opens a SmartCardConnection, reads the certificate, and converts to SSH wire format.
     */
    open suspend fun listKeys(): List<SshPublicKey> = withContext(Dispatchers.IO) {
        val device = usbDevice ?: nfcDevice
            ?: throw IllegalStateException("No Yubikey connected")

        try {
            device.openConnection(SmartCardConnection::class.java).use { connection ->
                val piv = PivSession(connection)
                val cert: X509Certificate = try {
                    piv.getCertificate(Slot.AUTHENTICATION)
                } catch (e: ApduException) {
                    Log.w(TAG, "No certificate in slot 9a", e)
                    return@withContext emptyList()
                }

                val blob = SshKeyFormatter.toSshPublicKeyBlob(cert)
                val comment = "YubiKey PIV Slot 9a"
                listOf(SshPublicKey(blob = blob, comment = comment))
            }
        } catch (e: java.io.IOException) {
            // Connection lost (USB yanked or NFC field lost) — update status
            if (device is NfcYubiKeyDevice) {
                nfcDevice = null
                _status.postValue(YubikeyStatus.DISCONNECTED)
            }
            throw e
        }
    }

    /**
     * Sign data using PIV slot 9a (Authentication) with ECDSA P-256.
     *
     * @param data Raw data to sign
     * @param pin Optional PIN — if provided, verifies PIN before signing. On success, caches the PIN.
     * @return DER-encoded ECDSA signature
     * @throws WrongPinException if PIN is incorrect (includes retries remaining)
     * @throws PinBlockedException if PIN is blocked (0 retries, SW 0x6983)
     * @throws IllegalStateException if no Yubikey is connected or key type is unsupported
     */
    open suspend fun sign(data: ByteArray, pin: CharArray?): ByteArray = withContext(Dispatchers.IO) {
        val device = usbDevice ?: nfcDevice
            ?: throw IllegalStateException("No Yubikey connected")

        try {
            device.openConnection(SmartCardConnection::class.java).use { connection ->
                val piv = PivSession(connection)

                // Determine the key type and verify it's ECCP256
                val metadata = try {
                    piv.getSlotMetadata(Slot.AUTHENTICATION)
                } catch (e: ApduException) {
                    throw IllegalStateException("Cannot read slot metadata — ensure a key is loaded in slot 9a", e)
                }

                if (metadata.keyType != KeyType.ECCP256) {
                    throw IllegalStateException(
                        "Unsupported key type: ${metadata.keyType}. Only ECDSA P-256 (ECCP256) is supported."
                    )
                }

                // Verify PIN — use provided pin or fall back to cached pin
                val pinToUse = pin ?: cachedPin
                if (pinToUse != null) {
                    try {
                        piv.verifyPin(pinToUse)
                        // Cache on successful verification
                        if (pin != null && cachedPin == null) {
                            cachedPin = pin.copyOf()
                        }
                    } catch (e: ApduException) {
                        handlePinError(e)
                    }
                }

                piv.rawSignOrDecrypt(Slot.AUTHENTICATION, KeyType.ECCP256, data)
            }
        } catch (e: java.io.IOException) {
            // Connection lost (USB yanked or NFC field lost) — update status
            if (device is NfcYubiKeyDevice) {
                nfcDevice = null
                _status.postValue(YubikeyStatus.DISCONNECTED)
            }
            throw e
        }
    }

    /**
     * Clear the cached PIN, zeroing the array contents.
     */
    open fun clearPin() {
        cachedPin?.fill('\u0000')
        cachedPin = null
    }

    /**
     * Parse APDU error for PIN-related failures.
     * SW 0x63CX = wrong PIN, X = retries remaining.
     * SW 0x6983 = PIN blocked.
     */
    private fun handlePinError(e: ApduException): Nothing {
        val sw = e.sw
        if (sw == SW_PIN_BLOCKED.toInt()) {
            clearPin()
            throw PinBlockedException("PIN is blocked. Use ykman piv access unblock-pin to recover.")
        }
        // SW 0x63CX — wrong PIN, X = retries remaining
        if (sw and 0xFFF0 == 0x63C0) {
            val retries = sw and 0x000F
            throw WrongPinException(retries)
        }
        // Unknown APDU error — rethrow as-is
        throw e
    }
}
