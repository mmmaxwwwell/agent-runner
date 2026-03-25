package com.agentrunner

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.agentrunner.signing.KeyEntry
import com.agentrunner.signing.KeyRegistry
import com.agentrunner.signing.KeyType
import com.agentrunner.signing.KeystoreSigningBackend
import com.agentrunner.signing.YubikeySigningBackend
import com.agentrunner.yubikey.YubikeyManager
import com.agentrunner.yubikey.YubikeyStatus
import com.google.android.material.button.MaterialButton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class KeyManagementActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "KeyManagement"
        const val EXTRA_REQUIRE_BIOMETRIC = "require_biometric"
    }

    private lateinit var registry: KeyRegistry
    private lateinit var yubikeyManager: YubikeyManager
    private lateinit var yubikeyBackend: YubikeySigningBackend
    private lateinit var keystoreBackend: KeystoreSigningBackend

    private lateinit var keyList: RecyclerView
    private lateinit var emptyState: TextView
    private lateinit var addYubikeyButton: MaterialButton
    private lateinit var generateAppKeyButton: MaterialButton

    private val adapter = KeyAdapter()
    private val activityScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_key_management)

        registry = KeyRegistry(applicationContext)
        yubikeyManager = YubikeyManager(applicationContext)
        yubikeyBackend = YubikeySigningBackend(yubikeyManager, registry)
        val requireBiometric = intent.getBooleanExtra(EXTRA_REQUIRE_BIOMETRIC, true)
        keystoreBackend = KeystoreSigningBackend(this, registry, requireBiometric = requireBiometric)

        keyList = findViewById(R.id.keyList)
        emptyState = findViewById(R.id.emptyState)
        addYubikeyButton = findViewById(R.id.addYubikeyButton)
        generateAppKeyButton = findViewById(R.id.generateAppKeyButton)

        keyList.layoutManager = LinearLayoutManager(this)
        keyList.adapter = adapter

        findViewById<View>(R.id.backButton).setOnClickListener { finish() }

        addYubikeyButton.setOnClickListener { onAddYubikey() }
        generateAppKeyButton.setOnClickListener { onGenerateAppKey() }

        // Observe Yubikey status to auto-detect and register keys
        yubikeyManager.status.observe(this) { status ->
            if (status == YubikeyStatus.CONNECTED_USB || status == YubikeyStatus.CONNECTED_NFC) {
                activityScope.launch {
                    yubikeyBackend.onYubikeyConnected()
                    refreshKeys()
                }
            }
        }

        refreshKeys()
    }

    override fun onResume() {
        super.onResume()
        yubikeyManager.startDiscovery(this)
        refreshKeys()
    }

    override fun onPause() {
        yubikeyManager.stopDiscovery(this)
        super.onPause()
    }

    private fun refreshKeys() {
        val keys = registry.listKeys()
        adapter.submitList(keys)
        emptyState.visibility = if (keys.isEmpty()) View.VISIBLE else View.GONE
        keyList.visibility = if (keys.isEmpty()) View.GONE else View.VISIBLE
    }

    private fun onAddYubikey() {
        val status = yubikeyManager.status.value
        if (status == YubikeyStatus.CONNECTED_USB || status == YubikeyStatus.CONNECTED_NFC) {
            activityScope.launch {
                try {
                    yubikeyBackend.onYubikeyConnected()
                    refreshKeys()
                    Toast.makeText(this@KeyManagementActivity, R.string.key_mgmt_yubikey_added, Toast.LENGTH_SHORT).show()
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to read YubiKey", e)
                    Toast.makeText(this@KeyManagementActivity, getString(R.string.key_mgmt_yubikey_error, e.message), Toast.LENGTH_LONG).show()
                }
            }
        } else {
            Toast.makeText(this, R.string.key_mgmt_connect_yubikey, Toast.LENGTH_LONG).show()
        }
    }

    private fun onGenerateAppKey() {
        val input = EditText(this).apply {
            hint = getString(R.string.key_mgmt_key_name_hint)
            setPadding(48, 32, 48, 16)
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.key_mgmt_generate_app_key_title)
            .setView(input)
            .setPositiveButton(R.string.key_mgmt_generate) { _, _ ->
                val name = input.text.toString().trim()
                if (name.isEmpty()) {
                    Toast.makeText(this, R.string.key_mgmt_name_required, Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                activityScope.launch {
                    try {
                        keystoreBackend.generateKey(name)
                        refreshKeys()
                        Toast.makeText(this@KeyManagementActivity, R.string.key_mgmt_key_generated, Toast.LENGTH_SHORT).show()
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to generate key", e)
                        Toast.makeText(this@KeyManagementActivity, getString(R.string.key_mgmt_generate_error, e.message), Toast.LENGTH_LONG).show()
                    }
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun onExportKey(entry: KeyEntry) {
        val authorizedKey = registry.exportAuthorizedKey(entry)
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("SSH Public Key", authorizedKey))
        Toast.makeText(this, R.string.key_mgmt_exported, Toast.LENGTH_SHORT).show()
    }

    private fun onRenameKey(entry: KeyEntry) {
        val input = EditText(this).apply {
            setText(entry.name)
            setPadding(48, 32, 48, 16)
            selectAll()
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.key_mgmt_rename_title)
            .setView(input)
            .setPositiveButton(R.string.key_mgmt_rename) { _, _ ->
                val newName = input.text.toString().trim()
                if (newName.isEmpty()) {
                    Toast.makeText(this, R.string.key_mgmt_name_required, Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                try {
                    registry.updateKey(entry.id) { it.copy(name = newName) }
                    refreshKeys()
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to rename key", e)
                    Toast.makeText(this, getString(R.string.key_mgmt_rename_error, e.message), Toast.LENGTH_LONG).show()
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun onRemoveKey(entry: KeyEntry) {
        AlertDialog.Builder(this)
            .setTitle(R.string.key_mgmt_remove_title)
            .setMessage(getString(R.string.key_mgmt_remove_confirm, entry.name, entry.fingerprint))
            .setPositiveButton(R.string.key_mgmt_remove) { _, _ ->
                activityScope.launch {
                    try {
                        if (entry.type == KeyType.ANDROID_KEYSTORE) {
                            keystoreBackend.deleteKey(entry.id)
                        } else {
                            registry.removeKey(entry.id)
                        }
                        refreshKeys()
                        Toast.makeText(this@KeyManagementActivity, R.string.key_mgmt_removed, Toast.LENGTH_SHORT).show()
                    } catch (e: Exception) {
                        Log.e(TAG, "Failed to remove key", e)
                        Toast.makeText(this@KeyManagementActivity, getString(R.string.key_mgmt_remove_error, e.message), Toast.LENGTH_LONG).show()
                    }
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    // --- RecyclerView Adapter ---

    private inner class KeyAdapter : RecyclerView.Adapter<KeyViewHolder>() {
        private var keys: List<KeyEntry> = emptyList()

        fun submitList(newKeys: List<KeyEntry>) {
            keys = newKeys
            notifyDataSetChanged()
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): KeyViewHolder {
            val view = LayoutInflater.from(parent.context).inflate(R.layout.item_key, parent, false)
            return KeyViewHolder(view)
        }

        override fun onBindViewHolder(holder: KeyViewHolder, position: Int) {
            holder.bind(keys[position])
        }

        override fun getItemCount(): Int = keys.size
    }

    private inner class KeyViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        private val keyName: TextView = view.findViewById(R.id.keyName)
        private val keyType: TextView = view.findViewById(R.id.keyType)
        private val keyFingerprint: TextView = view.findViewById(R.id.keyFingerprint)
        private val keyLastUsed: TextView = view.findViewById(R.id.keyLastUsed)
        private val exportButton: MaterialButton = view.findViewById(R.id.exportButton)
        private val renameButton: MaterialButton = view.findViewById(R.id.renameButton)
        private val removeButton: MaterialButton = view.findViewById(R.id.removeButton)

        fun bind(entry: KeyEntry) {
            keyName.text = entry.name
            keyType.text = when (entry.type) {
                KeyType.YUBIKEY_PIV -> "YubiKey"
                KeyType.ANDROID_KEYSTORE -> "App Key"
                KeyType.MOCK -> "Test Key"
            }
            keyFingerprint.text = entry.fingerprint
            keyLastUsed.text = if (entry.lastUsedAt != null) {
                getString(R.string.key_mgmt_last_used, entry.lastUsedAt)
            } else {
                getString(R.string.key_mgmt_never_used)
            }

            exportButton.setOnClickListener { onExportKey(entry) }
            renameButton.setOnClickListener { onRenameKey(entry) }
            removeButton.setOnClickListener { onRemoveKey(entry) }
        }
    }
}
