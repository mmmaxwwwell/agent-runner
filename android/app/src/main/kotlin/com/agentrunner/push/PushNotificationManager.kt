package com.agentrunner.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Base64
import android.util.Log
import androidx.core.app.NotificationCompat
import com.agentrunner.MainActivity
import com.agentrunner.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.security.KeyPairGenerator
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec

class PushNotificationManager(private val context: Context) {

    companion object {
        private const val TAG = "AgentRunner"
        const val CHANNEL_ID = "agent_runner_notifications"
        const val EXTRA_NAVIGATE_HASH = "navigate_hash"
        private const val PREFS_NAME = "agent_runner_push"
        private const val KEY_ENDPOINT = "push_endpoint"
        private const val KEY_P256DH = "push_p256dh"
        private const val KEY_AUTH = "push_auth"
        private const val KEY_SUBSCRIBED = "push_subscribed"
    }

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val client = OkHttpClient()
    private var notificationIdCounter = 0

    init {
        createNotificationChannel()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = context.getString(R.string.notification_channel_description)
        }
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    /**
     * Subscribe to push notifications from the server.
     * Generates ECDH P-256 keys for web-push encryption, then registers
     * the subscription with the server's push API.
     *
     * @param serverUrl The agent-runner server base URL
     * @param pushEndpoint The push service endpoint URL (e.g., from FCM)
     */
    suspend fun subscribe(serverUrl: String, pushEndpoint: String) {
        val keyPair = generateEcdhKeyPair()
        val publicKey = keyPair.public as ECPublicKey
        val p256dh = Base64.encodeToString(
            encodeUncompressedPoint(publicKey),
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
        )
        val authSecret = generateAuthSecret()
        val auth = Base64.encodeToString(
            authSecret,
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
        )

        val body = JSONObject().apply {
            put("endpoint", pushEndpoint)
            put("keys", JSONObject().apply {
                put("p256dh", p256dh)
                put("auth", auth)
            })
        }

        val request = Request.Builder()
            .url("${serverUrl.trimEnd('/')}/api/push/subscribe")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()

        withContext(Dispatchers.IO) {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    throw IOException("Push subscribe failed: ${response.code}")
                }
            }
        }

        prefs.edit()
            .putString(KEY_ENDPOINT, pushEndpoint)
            .putString(KEY_P256DH, p256dh)
            .putString(KEY_AUTH, auth)
            .putBoolean(KEY_SUBSCRIBED, true)
            .apply()

        Log.d(TAG, "Push subscription registered")
    }

    fun isSubscribed(): Boolean = prefs.getBoolean(KEY_SUBSCRIBED, false)

    fun clearSubscription() {
        prefs.edit()
            .remove(KEY_ENDPOINT)
            .remove(KEY_P256DH)
            .remove(KEY_AUTH)
            .putBoolean(KEY_SUBSCRIBED, false)
            .apply()
    }

    fun showNotification(title: String, body: String, data: Map<String, String> = emptyMap()) {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            val hash = data["sessionId"]?.let { "#/sessions/$it" }
                ?: data["projectId"]?.let { "#/projects/$it" }
            hash?.let { putExtra(EXTRA_NAVIGATE_HASH, it) }
        }

        val pendingIntent = PendingIntent.getActivity(
            context,
            notificationIdCounter,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        val manager = context.getSystemService(NotificationManager::class.java)
        manager.notify(notificationIdCounter++, notification)
    }

    private fun generateEcdhKeyPair() =
        KeyPairGenerator.getInstance("EC").apply {
            initialize(ECGenParameterSpec("secp256r1"))
        }.generateKeyPair()

    private fun generateAuthSecret(): ByteArray {
        val secret = ByteArray(16)
        SecureRandom().nextBytes(secret)
        return secret
    }

    private fun encodeUncompressedPoint(key: ECPublicKey): ByteArray {
        val x = bigIntToFixedBytes(key.w.affineX.toByteArray(), 32)
        val y = bigIntToFixedBytes(key.w.affineY.toByteArray(), 32)
        return byteArrayOf(0x04) + x + y
    }

    private fun bigIntToFixedBytes(bytes: ByteArray, size: Int): ByteArray = when {
        bytes.size > size -> bytes.copyOfRange(bytes.size - size, bytes.size)
        bytes.size < size -> ByteArray(size - bytes.size) + bytes
        else -> bytes
    }
}
