package com.agentrunner.bridge

import android.app.Dialog
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.TextView
import androidx.fragment.app.DialogFragment
import androidx.lifecycle.LiveData
import com.agentrunner.R
import com.agentrunner.signing.KeyEntry
import com.agentrunner.signing.KeyType
import com.agentrunner.yubikey.YubikeyStatus
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout

/**
 * Modal dialog shown when a sign request arrives.
 *
 * Supports multi-key selection per FR-103:
 * - Auto-selects if only one key matches the requested key blob
 * - Shows a key picker when multiple keys can fulfill the request
 * - Shows key status indicators (ready / connect Yubikey / unavailable)
 * - PIN prompt for Yubikey keys, biometric prompt triggered by backend for app keys
 *
 * Non-cancellable via back press — user must tap Cancel.
 * Auto-dismissed by the host when signing completes or is cancelled.
 */
class SignRequestDialog : DialogFragment() {

    /**
     * Describes a key that can potentially sign the current request,
     * along with its current availability status.
     */
    data class MatchingKey(
        val entry: KeyEntry,
        val available: Boolean
    )

    /**
     * Callback interface for user actions in the dialog.
     */
    interface Callback {
        fun onPinSubmitted(pin: CharArray)
        fun onSignCancelled()
        fun onKeySelected(keyId: String)
    }

    private var callback: Callback? = null
    private var yubikeyStatus: LiveData<YubikeyStatus>? = null
    private var matchingKeys: List<MatchingKey> = emptyList()

    private lateinit var contextText: TextView
    private lateinit var queueBadge: TextView
    private lateinit var keyPickerLabel: TextView
    private lateinit var keyPickerGroup: RadioGroup
    private lateinit var pinInputLayout: TextInputLayout
    private lateinit var pinEditText: TextInputEditText
    private lateinit var pinErrorText: TextView
    private lateinit var statusText: TextView
    private lateinit var cancelButton: MaterialButton

    private var pinRequired = false
    private var selectedKeyId: String? = null

    companion object {
        private const val ARG_CONTEXT = "context"
        private const val ARG_PIN_REQUIRED = "pin_required"
        private const val ARG_QUEUE_POSITION = "queue_position"
        private const val ARG_QUEUE_TOTAL = "queue_total"

        fun newInstance(
            operationContext: String,
            pinRequired: Boolean,
            queuePosition: Int = 1,
            queueTotal: Int = 1
        ): SignRequestDialog {
            return SignRequestDialog().apply {
                arguments = Bundle().apply {
                    putString(ARG_CONTEXT, operationContext)
                    putBoolean(ARG_PIN_REQUIRED, pinRequired)
                    putInt(ARG_QUEUE_POSITION, queuePosition)
                    putInt(ARG_QUEUE_TOTAL, queueTotal)
                }
            }
        }
    }

    /**
     * Set the callback and Yubikey status LiveData before showing the dialog.
     * Must be called before show() since DialogFragment arguments survive rotation
     * but these references do not.
     *
     * @param matchingKeys keys that can fulfill this request, with availability status.
     *   If empty or single-entry, no picker is shown (auto-select).
     */
    fun configure(
        callback: Callback,
        yubikeyStatus: LiveData<YubikeyStatus>,
        matchingKeys: List<MatchingKey> = emptyList()
    ) {
        this.callback = callback
        this.yubikeyStatus = yubikeyStatus
        this.matchingKeys = matchingKeys
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        isCancelable = false
    }

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        return super.onCreateDialog(savedInstanceState).apply {
            setCanceledOnTouchOutside(false)
        }
    }

    override fun onCreateView(
        inflater: LayoutInflater,
        container: ViewGroup?,
        savedInstanceState: Bundle?
    ): View {
        return inflater.inflate(R.layout.dialog_sign_request, container, false)
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        contextText = view.findViewById(R.id.contextText)
        queueBadge = view.findViewById(R.id.queueBadge)
        keyPickerLabel = view.findViewById(R.id.keyPickerLabel)
        keyPickerGroup = view.findViewById(R.id.keyPickerGroup)
        pinInputLayout = view.findViewById(R.id.pinInputLayout)
        pinEditText = view.findViewById(R.id.pinEditText)
        pinErrorText = view.findViewById(R.id.pinErrorText)
        statusText = view.findViewById(R.id.statusText)
        cancelButton = view.findViewById(R.id.cancelButton)

        pinRequired = arguments?.getBoolean(ARG_PIN_REQUIRED, false) ?: false
        val operationContext = arguments?.getString(ARG_CONTEXT) ?: ""
        val queuePosition = arguments?.getInt(ARG_QUEUE_POSITION, 1) ?: 1
        val queueTotal = arguments?.getInt(ARG_QUEUE_TOTAL, 1) ?: 1

        contextText.text = operationContext
        updateQueueBadge(queuePosition, queueTotal)

        setupKeyPicker()

        cancelButton.setOnClickListener {
            callback?.onSignCancelled()
        }

        yubikeyStatus?.observe(viewLifecycleOwner) { status ->
            updateStatusForSelectedKey()
            updateKeyAvailability()
        }
    }

    /**
     * Set up the key picker UI based on matching keys.
     *
     * - 0 or 1 keys: no picker shown, auto-select the single key (or use legacy behavior)
     * - 2+ keys: show RadioGroup with status indicators
     */
    private fun setupKeyPicker() {
        if (matchingKeys.size <= 1) {
            // Auto-select: no picker needed
            keyPickerLabel.visibility = View.GONE
            keyPickerGroup.visibility = View.GONE
            selectedKeyId = matchingKeys.firstOrNull()?.entry?.id
            updateInputsForSelectedKey()
            return
        }

        // Show picker for multiple keys
        keyPickerLabel.visibility = View.VISIBLE
        keyPickerGroup.visibility = View.VISIBLE
        keyPickerGroup.removeAllViews()

        // Pre-select the first available key
        val firstAvailable = matchingKeys.firstOrNull { it.available }

        for ((index, matchingKey) in matchingKeys.withIndex()) {
            val radio = RadioButton(requireContext()).apply {
                id = View.generateViewId()
                text = formatKeyLabel(matchingKey)
                tag = matchingKey.entry.id
                isEnabled = matchingKey.available
                setPadding(0, 8, 0, 8)
            }
            keyPickerGroup.addView(radio)

            if (matchingKey.entry.id == firstAvailable?.entry?.id) {
                radio.isChecked = true
                selectedKeyId = matchingKey.entry.id
            }
        }

        keyPickerGroup.setOnCheckedChangeListener { group, checkedId ->
            val radio = group.findViewById<RadioButton>(checkedId) ?: return@setOnCheckedChangeListener
            val keyId = radio.tag as? String ?: return@setOnCheckedChangeListener
            selectedKeyId = keyId
            updateInputsForSelectedKey()
            callback?.onKeySelected(keyId)
        }

        updateInputsForSelectedKey()

        // Notify callback of initial selection
        selectedKeyId?.let { callback?.onKeySelected(it) }
    }

    /**
     * Format a key label for the radio button: "Name (Type) — Status"
     */
    private fun formatKeyLabel(matchingKey: MatchingKey): String {
        val entry = matchingKey.entry
        val typeName = when (entry.type) {
            KeyType.YUBIKEY_PIV -> "YubiKey"
            KeyType.ANDROID_KEYSTORE -> "App Key"
            KeyType.MOCK -> "Test Key"
        }
        val status = if (matchingKey.available) {
            getString(R.string.sign_request_key_ready)
        } else {
            when (entry.type) {
                KeyType.YUBIKEY_PIV -> getString(R.string.sign_request_key_connect_yubikey)
                else -> getString(R.string.sign_request_key_unavailable)
            }
        }
        val fingerprint = entry.fingerprint.take(20) // Truncate for display
        return "$typeName: ${entry.name}\n$fingerprint — $status"
    }

    /**
     * Update PIN input and status text based on the currently selected key type.
     */
    private fun updateInputsForSelectedKey() {
        val selected = matchingKeys.find { it.entry.id == selectedKeyId }
        if (selected == null) {
            // Legacy single-key behavior (no matching keys provided)
            if (pinRequired) {
                pinInputLayout.visibility = View.VISIBLE
                pinEditText.setOnEditorActionListener { _, actionId, _ ->
                    if (actionId == EditorInfo.IME_ACTION_DONE) {
                        submitPin()
                        true
                    } else {
                        false
                    }
                }
            }
            return
        }

        when (selected.entry.type) {
            KeyType.YUBIKEY_PIV -> {
                // Show PIN input if needed, Yubikey status text
                if (pinRequired) {
                    pinInputLayout.visibility = View.VISIBLE
                    pinEditText.setOnEditorActionListener { _, actionId, _ ->
                        if (actionId == EditorInfo.IME_ACTION_DONE) {
                            submitPin()
                            true
                        } else {
                            false
                        }
                    }
                } else {
                    pinInputLayout.visibility = View.GONE
                }
                updateStatusForSelectedKey()
            }
            KeyType.ANDROID_KEYSTORE -> {
                // No PIN needed — biometric is handled by the backend
                pinInputLayout.visibility = View.GONE
                statusText.text = getString(R.string.sign_request_authenticate)
            }
            KeyType.MOCK -> {
                // No user interaction needed
                pinInputLayout.visibility = View.GONE
                statusText.text = getString(R.string.sign_request_key_ready)
            }
        }

        // Clear any previous PIN error when switching keys
        pinErrorText.visibility = View.GONE
    }

    /**
     * Update status text based on Yubikey status (only relevant when a Yubikey key is selected).
     */
    private fun updateStatusForSelectedKey() {
        val selected = matchingKeys.find { it.entry.id == selectedKeyId }
        // Only update Yubikey status text if a Yubikey key is selected (or no keys provided for legacy)
        if (selected != null && selected.entry.type != KeyType.YUBIKEY_PIV) return

        val status = yubikeyStatus?.value ?: YubikeyStatus.DISCONNECTED
        statusText.text = when (status) {
            YubikeyStatus.DISCONNECTED -> getString(R.string.sign_request_connect_yubikey)
            YubikeyStatus.CONNECTED_USB, YubikeyStatus.CONNECTED_NFC -> {
                if (pinRequired && pinInputLayout.visibility == View.VISIBLE) {
                    getString(R.string.sign_request_enter_pin_and_touch)
                } else {
                    getString(R.string.sign_request_touch_yubikey)
                }
            }
            YubikeyStatus.ERROR -> getString(R.string.sign_request_connect_yubikey)
        }
    }

    /**
     * Update radio button labels when Yubikey availability changes.
     */
    private fun updateKeyAvailability() {
        if (matchingKeys.size <= 1) return
        // Re-format labels; availability is evaluated live by the caller who can
        // call updateMatchingKeys() to refresh
    }

    /**
     * Update the matching keys list (e.g., when Yubikey connects/disconnects).
     * Called by the host to refresh availability status.
     */
    fun updateMatchingKeys(keys: List<MatchingKey>) {
        if (!isAdded) return
        this.matchingKeys = keys

        if (keys.size <= 1) return

        for (i in 0 until keyPickerGroup.childCount) {
            val radio = keyPickerGroup.getChildAt(i) as? RadioButton ?: continue
            val keyId = radio.tag as? String ?: continue
            val matchingKey = keys.find { it.entry.id == keyId } ?: continue
            radio.text = formatKeyLabel(matchingKey)
            radio.isEnabled = matchingKey.available
        }
    }

    private fun submitPin() {
        val pinText = pinEditText.text?.toString() ?: ""
        if (pinText.isEmpty()) return

        pinErrorText.visibility = View.GONE
        val pin = pinText.toCharArray()
        pinEditText.text?.clear()
        callback?.onPinSubmitted(pin)
    }

    /**
     * Update the queue count badge (e.g., "Request 1 of 3").
     */
    fun showQueueBadge(position: Int, total: Int) {
        if (!isAdded) return
        updateQueueBadge(position, total)
    }

    private fun updateQueueBadge(position: Int, total: Int) {
        if (total > 1) {
            queueBadge.text = getString(R.string.sign_request_queue_badge, position, total)
            queueBadge.visibility = View.VISIBLE
        } else {
            queueBadge.visibility = View.GONE
        }
    }

    /**
     * Show a PIN verification error with retries remaining.
     */
    fun showPinError(message: String, retriesRemaining: Int) {
        if (!isAdded) return
        pinErrorText.text = getString(R.string.pin_wrong, retriesRemaining)
        pinErrorText.visibility = View.VISIBLE
        pinInputLayout.visibility = View.VISIBLE
        pinEditText.requestFocus()
    }

    /**
     * Show a PIN blocked error. The dialog will be dismissed by the handler shortly after.
     */
    fun showPinBlocked(message: String) {
        if (!isAdded) return
        pinErrorText.text = getString(R.string.pin_blocked)
        pinErrorText.visibility = View.VISIBLE
        pinInputLayout.visibility = View.GONE
    }

    /**
     * Show a general signing error.
     */
    fun showSignError(message: String) {
        if (!isAdded) return
        pinErrorText.text = message
        pinErrorText.visibility = View.VISIBLE
    }

    /**
     * Get the currently selected key ID.
     */
    fun getSelectedKeyId(): String? = selectedKeyId

    override fun onDestroyView() {
        super.onDestroyView()
        callback = null
        yubikeyStatus = null
    }
}
