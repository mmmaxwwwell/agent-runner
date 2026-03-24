package com.agentrunner

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.agentrunner.config.ServerConfig
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout

class ServerConfigActivity : AppCompatActivity() {

    private lateinit var urlInputLayout: TextInputLayout
    private lateinit var urlEditText: TextInputEditText
    private lateinit var connectButton: MaterialButton

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_server_config)

        urlInputLayout = findViewById(R.id.urlInputLayout)
        urlEditText = findViewById(R.id.urlEditText)
        connectButton = findViewById(R.id.connectButton)

        // Pre-populate with saved URL if editing
        ServerConfig.load(this)?.let { config ->
            urlEditText.setText(config.serverUrl)
        }

        connectButton.setOnClickListener {
            val url = urlEditText.text?.toString()?.trim() ?: ""

            if (url.isEmpty()) {
                urlInputLayout.error = getString(R.string.server_url_empty)
                return@setOnClickListener
            }

            if (!ServerConfig.isValidUrl(url)) {
                urlInputLayout.error = getString(R.string.server_url_invalid)
                return@setOnClickListener
            }

            urlInputLayout.error = null

            val config = ServerConfig(url)
            ServerConfig.save(this, config)

            val intent = Intent(this, MainActivity::class.java)
            intent.putExtra(EXTRA_SERVER_URL, url)
            intent.flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK
            startActivity(intent)
            finish()
        }

        // Clear error when user types
        urlEditText.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                urlInputLayout.error = null
            }
            override fun afterTextChanged(s: android.text.Editable?) {}
        })
    }

    companion object {
        const val EXTRA_SERVER_URL = "server_url"
    }
}
