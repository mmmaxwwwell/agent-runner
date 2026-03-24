package com.agentrunner.config

import android.content.Context

data class ServerConfig(
    val serverUrl: String
) {
    companion object {
        private const val PREFS_NAME = "agent_runner_prefs"
        private const val KEY_SERVER_URL = "server_url"

        fun load(context: Context): ServerConfig? {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val url = prefs.getString(KEY_SERVER_URL, null)
            if (url.isNullOrEmpty()) return null
            return ServerConfig(url)
        }

        fun save(context: Context, config: ServerConfig) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_SERVER_URL, config.serverUrl)
                .apply()
        }

        fun isValidUrl(url: String): Boolean {
            val trimmed = url.trim()
            if (trimmed.isEmpty()) return false
            if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return false
            // Must have something after the scheme
            val afterScheme = trimmed.removePrefix("http://").removePrefix("https://")
            return afterScheme.isNotEmpty()
        }
    }
}
