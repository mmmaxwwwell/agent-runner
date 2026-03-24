# Data Model: Android Client

## New Entities (Kotlin)

### YubikeyManager

Manages Yubikey detection and PIV operations. Wraps `YubiKitManager`.

```kotlin
class YubikeyManager(context: Context) {
    val status: LiveData<YubikeyStatus>     // Observable connection state

    fun startDiscovery(activity: Activity)  // Start USB + NFC listening
    fun stopDiscovery(activity: Activity)   // Stop listening

    suspend fun listKeys(): List<SshPublicKey>           // Read cert from slot 9a
    suspend fun sign(data: ByteArray): ByteArray         // Sign via slot 9a (ECDSA P-256)
    suspend fun verifyPin(pin: CharArray)                // PIN verification
}

enum class YubikeyStatus {
    DISCONNECTED,           // No Yubikey detected
    CONNECTED_USB,          // Connected via USB-C
    CONNECTED_NFC,          // Tapped via NFC (transient)
    ERROR                   // Connection error
}

data class SshPublicKey(
    val blob: ByteArray,    // SSH wire format public key
    val comment: String     // e.g., "YubiKey #20569688 PIV Slot 9a"
)
```

### SignRequestHandler

Handles SSH agent sign requests from WebSocket, displays modal, drives Yubikey interaction.

```kotlin
class SignRequestHandler(
    private val yubikey: YubikeyManager,
    private val webSocket: AgentWebSocket
) {
    private val requestQueue: Queue<SignRequest> = LinkedList()

    fun onSignRequest(request: SignRequest)     // Queue and show modal
    fun onCancel()                              // User cancels current request

    // Internal: on Yubikey touch → sign → send response
}

data class SignRequest(
    val requestId: String,
    val messageType: Int,           // 11 or 13
    val context: String,            // Human-readable description
    val data: String                // Base64-encoded SSH agent message
)
```

### AgentWebSocket

Native WebSocket connection to agent-runner session endpoint for SSH agent messages.

```kotlin
class AgentWebSocket(private val serverUrl: String) {
    var onSignRequest: ((SignRequest) -> Unit)? = null

    fun connect(sessionId: String)      // Open WS to /ws/sessions/<id>
    fun disconnect()                     // Close connection
    fun sendResponse(requestId: String, data: ByteArray)    // ssh-agent-response
    fun sendCancel(requestId: String)                        // ssh-agent-cancel
}
```

### ServerConfig

Persisted server URL.

```kotlin
data class ServerConfig(
    val serverUrl: String           // e.g., "http://192.168.1.100:3000"
) {
    companion object {
        fun load(context: Context): ServerConfig?       // From SharedPreferences
        fun save(context: Context, config: ServerConfig)
    }
}
```

### SignRequestModal

Native dialog shown when a sign request arrives.

```kotlin
class SignRequestDialog : DialogFragment() {
    // Shows:
    // - Operation context string
    // - Yubikey status (connected/waiting)
    // - "Touch Yubikey to authorize" instruction
    // - Cancel button

    // Auto-dismisses on successful sign or cancel
    // Queues multiple requests, shows one at a time
}
```

## Android Project Structure

```text
android/
├── app/
│   ├── build.gradle.kts
│   ├── src/main/
│   │   ├── AndroidManifest.xml
│   │   ├── kotlin/com/agentrunner/
│   │   │   ├── MainActivity.kt           # Single activity: WebView + native overlay
│   │   │   ├── ServerConfigActivity.kt   # First-launch URL configuration
│   │   │   ├── yubikey/
│   │   │   │   ├── YubikeyManager.kt     # USB/NFC detection, PIV operations
│   │   │   │   └── SshKeyFormatter.kt    # Convert X509 cert → SSH wire format
│   │   │   ├── bridge/
│   │   │   │   ├── AgentWebSocket.kt     # Native WebSocket for SSH agent messages
│   │   │   │   ├── SignRequestHandler.kt # Queue + process sign requests
│   │   │   │   └── SignRequestDialog.kt  # Modal dialog for sign authorization
│   │   │   └── config/
│   │   │       └── ServerConfig.kt       # SharedPreferences persistence
│   │   └── res/
│   │       ├── layout/
│   │       │   ├── activity_main.xml           # WebView
│   │       │   ├── activity_server_config.xml  # URL input
│   │       │   └── dialog_sign_request.xml     # Sign modal
│   │       ├── values/
│   │       │   └── strings.xml
│   │       └── xml/
│   │           └── usb_device_filter.xml       # Optional: Yubikey USB filter
│   └── src/test/                               # Unit tests
│       └── kotlin/com/agentrunner/
│           ├── yubikey/
│           │   └── SshKeyFormatterTest.kt
│           └── bridge/
│               └── SignRequestHandlerTest.kt
├── build.gradle.kts                            # Root build file
├── settings.gradle.kts
└── gradle.properties
```

## WebSocket Message Flow

```
Server (agent-runner)                    Android App
     │                                        │
     │  session output (existing)             │
     ├───────────────────────────────────────►│ WebView (existing PWA)
     │                                        │
     │  ssh-agent-request                     │
     ├───────────────────────────────────────►│ Native WebSocket (AgentWebSocket)
     │                                        │   → SignRequestHandler
     │                                        │   → SignRequestDialog (modal)
     │                                        │   → YubikeyManager.sign()
     │  ssh-agent-response                    │
     │◄───────────────────────────────────────┤ AgentWebSocket.sendResponse()
     │                                        │
```

Two WebSocket connections to the same session endpoint:
1. **WebView's** — handles output, state, progress, phase messages (existing PWA JS)
2. **Native's** — handles ssh-agent-request/response/cancel messages only
