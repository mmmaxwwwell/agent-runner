package com.agentrunner

import android.animation.ObjectAnimator
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.Toast
import android.view.animation.AccelerateDecelerateInterpolator
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.agentrunner.bridge.AgentWebSocket
import com.agentrunner.bridge.SignRequest
import com.agentrunner.bridge.SignRequestDialog
import com.agentrunner.bridge.SignRequestHandler
import com.agentrunner.bridge.SignRequestListener
import com.agentrunner.config.ServerConfig
import com.agentrunner.push.PushNotificationManager
import com.agentrunner.yubikey.YubikeyManager
import com.agentrunner.yubikey.YubikeyStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class MainActivity : AppCompatActivity(), SignRequestListener, SignRequestDialog.Callback {

    private lateinit var webView: WebView
    private var errorView: View? = null
    private var yubikeyStatusView: View? = null
    private var serverUrl: String? = null
    var currentSessionId: String? = null
        private set
    private var pendingNavigateHash: String? = null

    private lateinit var yubikeyManager: YubikeyManager
    private lateinit var pushManager: PushNotificationManager
    private var agentWebSocket: AgentWebSocket? = null
    private var signRequestHandler: SignRequestHandler? = null
    private var signDialog: SignRequestDialog? = null

    private val activityScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    companion object {
        private const val TAG = "AgentRunner"
        private const val SIGN_DIALOG_TAG = "sign_request_dialog"
        private const val STATE_SESSION_ID = "current_session_id"
        private const val STATE_SERVER_URL = "server_url"
        private val SESSION_HASH_PATTERN = Regex("""#/sessions/([0-9a-fA-F\-]{36})""")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Determine server URL: intent extra takes priority, then saved instance state, then saved config
        serverUrl = intent.getStringExtra(ServerConfigActivity.EXTRA_SERVER_URL)
            ?: savedInstanceState?.getString(STATE_SERVER_URL)
            ?: ServerConfig.load(this)?.serverUrl

        if (serverUrl == null) {
            startActivity(Intent(this, ServerConfigActivity::class.java))
            finish()
            return
        }

        yubikeyManager = YubikeyManager(applicationContext)
        pushManager = PushNotificationManager(applicationContext)

        // Save deep link hash for after WebView is ready
        pendingNavigateHash = intent.getStringExtra(PushNotificationManager.EXTRA_NAVIGATE_HASH)
        intent.removeExtra(PushNotificationManager.EXTRA_NAVIGATE_HASH)

        val container = FrameLayout(this)
        setContentView(container)

        webView = WebView(this)
        container.addView(webView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            userAgentString = "$userAgentString AgentRunner-Android"
        }

        webView.webViewClient = object : WebViewClient() {
            override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
                super.doUpdateVisitedHistory(view, url, isReload)
                url ?: return
                val fragment = Uri.parse(url).fragment
                val newSessionId = fragment?.let { SESSION_HASH_PATTERN.find("#$it")?.groupValues?.get(1) }
                if (newSessionId != currentSessionId) {
                    Log.d(TAG, "Session navigation: $currentSessionId -> $newSessionId")
                    onSessionChanged(currentSessionId, newSessionId)
                    currentSessionId = newSessionId
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                hideErrorView()
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    Log.e(TAG, "WebView error: ${error?.description} (code ${error?.errorCode})")
                    showErrorView(error?.description?.toString())
                }
            }

            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                errorResponse: WebResourceResponse?
            ) {
                super.onReceivedHttpError(view, request, errorResponse)
                if (request?.isForMainFrame == true) {
                    Log.e(TAG, "HTTP error: ${errorResponse?.statusCode} ${errorResponse?.reasonPhrase}")
                    showErrorView(
                        getString(R.string.error_webview_load) +
                            " (${errorResponse?.statusCode} ${errorResponse?.reasonPhrase})"
                    )
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                consoleMessage?.let {
                    val logLevel = when (it.messageLevel()) {
                        ConsoleMessage.MessageLevel.ERROR -> Log.ERROR
                        ConsoleMessage.MessageLevel.WARNING -> Log.WARN
                        ConsoleMessage.MessageLevel.DEBUG -> Log.DEBUG
                        else -> Log.INFO
                    }
                    Log.println(logLevel, TAG, "${it.message()} [${it.sourceId()}:${it.lineNumber()}]")
                }
                return true
            }
        }

        webView.addJavascriptInterface(AgentRunnerBridge(), "AgentRunner")

        setupYubikeyStatusOverlay(container)

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)

            // Restore session state and re-establish WebSocket connection
            currentSessionId = savedInstanceState.getString(STATE_SESSION_ID)
            if (currentSessionId != null && serverUrl != null) {
                connectWebSocket(currentSessionId!!)
            }

            // Re-configure surviving SignRequestDialog (fragment survives, but callback/LiveData don't)
            reconfigureSignDialog()
        } else {
            val hash = pendingNavigateHash
            pendingNavigateHash = null
            if (hash != null) {
                webView.loadUrl("${serverUrl}${hash}")
            } else {
                webView.loadUrl(serverUrl!!)
            }
        }
    }

    inner class AgentRunnerBridge {
        @JavascriptInterface
        fun openSettings() {
            runOnUiThread {
                startActivity(Intent(this@MainActivity, ServerConfigActivity::class.java))
            }
        }

        @JavascriptInterface
        fun getYubikeyStatus(): String {
            return when (yubikeyManager.status.value) {
                YubikeyStatus.CONNECTED_USB -> "connected_usb"
                YubikeyStatus.CONNECTED_NFC -> "connected_nfc"
                YubikeyStatus.ERROR -> "error"
                else -> "disconnected"
            }
        }

        @JavascriptInterface
        fun getYubikeySerial(): String {
            // Serial number requires opening a SmartCardConnection which is expensive/async.
            // Return empty string for now — serial is shown in the native overlay if available.
            return ""
        }

        @JavascriptInterface
        fun openKeyManagement() {
            runOnUiThread {
                startActivity(Intent(this@MainActivity, KeyManagementActivity::class.java))
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleNotificationIntent(intent)
    }

    private fun handleNotificationIntent(intent: Intent) {
        val hash = intent.getStringExtra(PushNotificationManager.EXTRA_NAVIGATE_HASH)
        if (hash != null && ::webView.isInitialized && serverUrl != null) {
            val url = "${serverUrl}${hash}"
            webView.loadUrl(url)
            // Clear so it doesn't re-navigate on rotation
            intent.removeExtra(PushNotificationManager.EXTRA_NAVIGATE_HASH)
        }
    }

    override fun onResume() {
        super.onResume()
        if (::yubikeyManager.isInitialized) {
            yubikeyManager.startDiscovery(this)
        }
    }

    override fun onPause() {
        if (::yubikeyManager.isInitialized) {
            yubikeyManager.stopDiscovery(this)
        }
        super.onPause()
    }

    private fun setupYubikeyStatusOverlay(container: FrameLayout) {
        val statusView = layoutInflater.inflate(R.layout.view_yubikey_status, container, false)
        container.addView(statusView)
        yubikeyStatusView = statusView

        // Set initial state
        updateYubikeyStatus(YubikeyStatus.DISCONNECTED)

        // Observe Yubikey connection state
        yubikeyManager.status.observe(this) { status ->
            updateYubikeyStatus(status)
            // Notify sign handler when Yubikey disconnects during an active sign operation
            if (status == YubikeyStatus.DISCONNECTED) {
                signRequestHandler?.onYubikeyDisconnected()
            }
        }
    }

    private fun updateYubikeyStatus(status: YubikeyStatus) {
        val statusText = yubikeyStatusView?.findViewById<TextView>(R.id.yubikeyStatusText) ?: return

        when (status) {
            YubikeyStatus.DISCONNECTED, YubikeyStatus.ERROR -> {
                statusText.text = getString(R.string.yubikey_disconnected)
                statusText.setBackgroundResource(R.drawable.yubikey_status_background)
            }
            YubikeyStatus.CONNECTED_USB -> {
                statusText.text = getString(R.string.yubikey_connected_usb)
                statusText.setBackgroundResource(R.drawable.yubikey_status_background_connected)
            }
            YubikeyStatus.CONNECTED_NFC -> {
                statusText.text = getString(R.string.yubikey_connected_nfc)
                statusText.setBackgroundResource(R.drawable.yubikey_status_background_connected)
                animateNfcTap(statusText)
            }
        }
    }

    private fun animateNfcTap(view: View) {
        ObjectAnimator.ofFloat(view, "alpha", 0.3f, 1f).apply {
            duration = 400
            interpolator = AccelerateDecelerateInterpolator()
            repeatCount = 1
            repeatMode = ObjectAnimator.REVERSE
            start()
        }
    }

    private fun onSessionChanged(oldSessionId: String?, newSessionId: String?) {
        // Disconnect from old session
        if (oldSessionId != null) {
            agentWebSocket?.disconnect()
            agentWebSocket = null
            signRequestHandler = null
        }

        // Connect to new session
        if (newSessionId != null && serverUrl != null) {
            connectWebSocket(newSessionId)
        }
    }

    private fun connectWebSocket(sessionId: String) {
        val ws = AgentWebSocket(serverUrl!!)
        val handler = SignRequestHandler(yubikeyManager, ws, this, activityScope)
        ws.onSignRequest = { request ->
            runOnUiThread { handler.onSignRequest(request) }
        }
        ws.onDisconnect = {
            runOnUiThread {
                handler.cancelAll()
                Toast.makeText(this, R.string.error_websocket_disconnected, Toast.LENGTH_LONG).show()
            }
        }
        agentWebSocket = ws
        signRequestHandler = handler
        ws.connect(sessionId)
        Log.d(TAG, "AgentWebSocket connected for session $sessionId")
    }

    private fun reconfigureSignDialog() {
        val dialog = supportFragmentManager.findFragmentByTag(SIGN_DIALOG_TAG) as? SignRequestDialog
        if (dialog != null) {
            dialog.configure(this, yubikeyManager.status)
            signDialog = dialog
        }
    }

    // --- SignRequestListener implementation ---

    override fun onShowSignDialog(request: SignRequest, pinRequired: Boolean, queuePosition: Int, queueTotal: Int, matchingKeys: List<SignRequestDialog.MatchingKey>) {
        val dialog = SignRequestDialog.newInstance(request.context, pinRequired, queuePosition, queueTotal)
        dialog.configure(this, yubikeyManager.status, matchingKeys)
        dialog.show(supportFragmentManager, SIGN_DIALOG_TAG)
        signDialog = dialog
    }

    override fun onQueueUpdated(queuePosition: Int, queueTotal: Int) {
        signDialog?.showQueueBadge(queuePosition, queueTotal)
    }

    override fun onDismissDialog() {
        signDialog?.dismissAllowingStateLoss()
        signDialog = null
    }

    override fun onPinError(message: String, retriesRemaining: Int) {
        signDialog?.showPinError(message, retriesRemaining)
    }

    override fun onPinBlocked(message: String) {
        signDialog?.showPinBlocked(message)
    }

    override fun onSignError(message: String) {
        signDialog?.showSignError(message)
    }

    override fun onUpdateMatchingKeys(matchingKeys: List<SignRequestDialog.MatchingKey>) {
        signDialog?.updateMatchingKeys(matchingKeys)
    }

    // --- SignRequestDialog.Callback implementation ---

    override fun onPinSubmitted(pin: CharArray) {
        signRequestHandler?.onPinEntered(pin)
    }

    override fun onSignCancelled() {
        signRequestHandler?.onCancel()
    }

    override fun onKeySelected(keyId: String) {
        signRequestHandler?.onKeySelected(keyId)
    }

    private fun showErrorView(errorDetail: String? = null) {
        if (errorView != null) return

        val container = webView.parent as? FrameLayout ?: return
        val view = layoutInflater.inflate(R.layout.view_error, container, false)

        if (errorDetail != null) {
            view.findViewById<TextView>(R.id.errorMessage).text = errorDetail
        }

        view.findViewById<View>(R.id.retryButton).setOnClickListener {
            hideErrorView()
            serverUrl?.let { url -> webView.loadUrl(url) }
        }

        view.findViewById<View>(R.id.changeServerButton).setOnClickListener {
            startActivity(Intent(this, ServerConfigActivity::class.java))
            finish()
        }

        container.addView(view)
        errorView = view
    }

    private fun hideErrorView() {
        errorView?.let {
            (it.parent as? FrameLayout)?.removeView(it)
            errorView = null
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::webView.isInitialized) {
            webView.saveState(outState)
        }
        outState.putString(STATE_SESSION_ID, currentSessionId)
        outState.putString(STATE_SERVER_URL, serverUrl)
    }

    @Deprecated("Use onBackPressedDispatcher")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        agentWebSocket?.disconnect()
        agentWebSocket = null
        signRequestHandler = null
        if (::yubikeyManager.isInitialized) {
            yubikeyManager.clearPin()
        }
        if (::webView.isInitialized) {
            webView.destroy()
        }
        super.onDestroy()
    }
}
