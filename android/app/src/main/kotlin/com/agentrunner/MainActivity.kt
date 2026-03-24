package com.agentrunner

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
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
import com.agentrunner.config.ServerConfig

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var errorView: View? = null
    private var serverUrl: String? = null
    var currentSessionId: String? = null
        private set

    companion object {
        private const val TAG = "AgentRunner"
        private val SESSION_HASH_PATTERN = Regex("""#/sessions/([0-9a-fA-F\-]{36})""")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Determine server URL: intent extra takes priority, then saved config
        serverUrl = intent.getStringExtra(ServerConfigActivity.EXTRA_SERVER_URL)
            ?: ServerConfig.load(this)?.serverUrl

        if (serverUrl == null) {
            startActivity(Intent(this, ServerConfigActivity::class.java))
            finish()
            return
        }

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

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(serverUrl!!)
        }
    }

    inner class AgentRunnerBridge {
        @JavascriptInterface
        fun openSettings() {
            runOnUiThread {
                startActivity(Intent(this@MainActivity, ServerConfigActivity::class.java))
            }
        }
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
        if (::webView.isInitialized) {
            webView.destroy()
        }
        super.onDestroy()
    }
}
