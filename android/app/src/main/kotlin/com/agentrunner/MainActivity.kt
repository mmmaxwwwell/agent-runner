package com.agentrunner

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import com.agentrunner.config.ServerConfig

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    var currentSessionId: String? = null
        private set

    companion object {
        private const val TAG = "AgentRunner"
        private val SESSION_HASH_PATTERN = Regex("""#/sessions/([0-9a-fA-F\-]{36})""")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Determine server URL: intent extra takes priority, then saved config
        val serverUrl = intent.getStringExtra(ServerConfigActivity.EXTRA_SERVER_URL)
            ?: ServerConfig.load(this)?.serverUrl

        if (serverUrl == null) {
            startActivity(Intent(this, ServerConfigActivity::class.java))
            finish()
            return
        }

        webView = WebView(this)
        setContentView(webView)

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

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    Log.e(TAG, "WebView error: ${error?.description} (code ${error?.errorCode})")
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

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(serverUrl)
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
