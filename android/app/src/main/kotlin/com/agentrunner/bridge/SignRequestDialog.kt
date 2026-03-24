package com.agentrunner.bridge

import android.app.Dialog
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.TextView
import androidx.fragment.app.DialogFragment
import androidx.lifecycle.LiveData
import com.agentrunner.R
import com.agentrunner.yubikey.YubikeyStatus
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout

/**
 * Modal dialog shown when a sign request arrives.
 *
 * Displays operation context, optional PIN input, Yubikey status, and a cancel button.
 * Non-cancellable via back press — user must tap Cancel.
 * Auto-dismissed by the host when signing completes or is cancelled.
 */
class SignRequestDialog : DialogFragment() {

    /**
     * Callback interface for user actions in the dialog.
     */
    interface Callback {
        fun onPinSubmitted(pin: CharArray)
        fun onSignCancelled()
    }

    private var callback: Callback? = null
    private var yubikeyStatus: LiveData<YubikeyStatus>? = null

    private lateinit var contextText: TextView
    private lateinit var pinInputLayout: TextInputLayout
    private lateinit var pinEditText: TextInputEditText
    private lateinit var pinErrorText: TextView
    private lateinit var statusText: TextView
    private lateinit var cancelButton: MaterialButton

    private var pinRequired = false

    companion object {
        private const val ARG_CONTEXT = "context"
        private const val ARG_PIN_REQUIRED = "pin_required"

        fun newInstance(
            operationContext: String,
            pinRequired: Boolean
        ): SignRequestDialog {
            return SignRequestDialog().apply {
                arguments = Bundle().apply {
                    putString(ARG_CONTEXT, operationContext)
                    putBoolean(ARG_PIN_REQUIRED, pinRequired)
                }
            }
        }
    }

    /**
     * Set the callback and Yubikey status LiveData before showing the dialog.
     * Must be called before show() since DialogFragment arguments survive rotation
     * but these references do not.
     */
    fun configure(callback: Callback, yubikeyStatus: LiveData<YubikeyStatus>) {
        this.callback = callback
        this.yubikeyStatus = yubikeyStatus
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
        pinInputLayout = view.findViewById(R.id.pinInputLayout)
        pinEditText = view.findViewById(R.id.pinEditText)
        pinErrorText = view.findViewById(R.id.pinErrorText)
        statusText = view.findViewById(R.id.statusText)
        cancelButton = view.findViewById(R.id.cancelButton)

        pinRequired = arguments?.getBoolean(ARG_PIN_REQUIRED, false) ?: false
        val operationContext = arguments?.getString(ARG_CONTEXT) ?: ""

        contextText.text = operationContext

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

        cancelButton.setOnClickListener {
            callback?.onSignCancelled()
        }

        yubikeyStatus?.observe(viewLifecycleOwner) { status ->
            updateStatusText(status)
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

    private fun updateStatusText(status: YubikeyStatus) {
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

    override fun onDestroyView() {
        super.onDestroyView()
        callback = null
        yubikeyStatus = null
    }
}
