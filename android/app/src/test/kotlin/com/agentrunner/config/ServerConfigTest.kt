package com.agentrunner.config

import android.content.Context
import android.content.SharedPreferences
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test

class ServerConfigTest {

    private lateinit var context: Context
    private lateinit var prefs: SharedPreferences
    private lateinit var editor: SharedPreferences.Editor

    @Before
    fun setUp() {
        editor = mockk(relaxed = true)
        prefs = mockk {
            every { edit() } returns editor
            every { getString(any(), any()) } returns null
        }
        context = mockk {
            every { getSharedPreferences("agent_runner_prefs", Context.MODE_PRIVATE) } returns prefs
        }
    }

    // --- load() tests ---

    @Test
    fun `load returns null when no URL is saved`() {
        every { prefs.getString("server_url", null) } returns null

        val config = ServerConfig.load(context)

        assertNull(config)
    }

    @Test
    fun `load returns ServerConfig when URL is saved`() {
        every { prefs.getString("server_url", null) } returns "https://example.com:3000"

        val config = ServerConfig.load(context)

        assertNotNull(config)
        assertEquals("https://example.com:3000", config!!.serverUrl)
    }

    @Test
    fun `load returns null when saved URL is empty string`() {
        every { prefs.getString("server_url", null) } returns ""

        val config = ServerConfig.load(context)

        assertNull(config)
    }

    // --- save() tests ---

    @Test
    fun `save persists URL to SharedPreferences`() {
        val urlSlot = slot<String>()
        every { editor.putString("server_url", capture(urlSlot)) } returns editor

        val config = ServerConfig("https://myserver.com:3000")
        ServerConfig.save(context, config)

        assertEquals("https://myserver.com:3000", urlSlot.captured)
        verify { editor.apply() }
    }

    // --- URL validation tests ---

    @Test
    fun `isValidUrl returns true for http URL`() {
        assertTrue(ServerConfig.isValidUrl("http://192.168.1.100:3000"))
    }

    @Test
    fun `isValidUrl returns true for https URL`() {
        assertTrue(ServerConfig.isValidUrl("https://example.com"))
    }

    @Test
    fun `isValidUrl returns true for https URL with port`() {
        assertTrue(ServerConfig.isValidUrl("https://example.com:8443"))
    }

    @Test
    fun `isValidUrl returns true for http localhost`() {
        assertTrue(ServerConfig.isValidUrl("http://localhost:3000"))
    }

    @Test
    fun `isValidUrl returns false for empty string`() {
        assertFalse(ServerConfig.isValidUrl(""))
    }

    @Test
    fun `isValidUrl returns false for missing scheme`() {
        assertFalse(ServerConfig.isValidUrl("example.com"))
    }

    @Test
    fun `isValidUrl returns false for ftp scheme`() {
        assertFalse(ServerConfig.isValidUrl("ftp://example.com"))
    }

    @Test
    fun `isValidUrl returns false for ws scheme`() {
        assertFalse(ServerConfig.isValidUrl("ws://example.com"))
    }

    @Test
    fun `isValidUrl returns false for just http prefix`() {
        assertFalse(ServerConfig.isValidUrl("http://"))
    }

    @Test
    fun `isValidUrl returns false for blank string`() {
        assertFalse(ServerConfig.isValidUrl("   "))
    }
}
