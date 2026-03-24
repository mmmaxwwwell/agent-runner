package com.agentrunner.bridge

import com.agentrunner.yubikey.SshPublicKey
import com.agentrunner.yubikey.YubikeyManager
import io.mockk.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.util.Base64

/**
 * Tests for SignRequestHandler — queuing sign requests, routing to
 * YubikeyManager, managing PIN prompts, and sending WebSocket responses.
 *
 * These tests define the expected API surface:
 * - SignRequestHandler(yubikey, webSocket, listener, scope)
 * - SignRequestHandler.onSignRequest(request)
 * - SignRequestHandler.onPinEntered(pin)
 * - SignRequestHandler.onCancel()
 * - SignRequestHandler.onYubikeyDisconnected()
 *
 * SignRequestListener callback interface:
 * - onShowSignDialog(request, pinRequired)
 * - onDismissDialog()
 * - onPinError(message, retriesRemaining)
 * - onPinBlocked(message)
 * - onSignError(message)
 *
 * Exceptions thrown by YubikeyManager:
 * - WrongPinException(retriesRemaining: Int)
 * - PinBlockedException(message: String)
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SignRequestHandlerTest {

    private lateinit var yubikey: YubikeyManager
    private lateinit var webSocket: AgentWebSocket
    private lateinit var listener: SignRequestListener
    private lateinit var testScope: TestScope
    private lateinit var handler: SignRequestHandler

    @Before
    fun setUp() {
        yubikey = mockk(relaxed = true)
        webSocket = mockk(relaxed = true)
        listener = mockk(relaxed = true)
        testScope = TestScope()
        handler = SignRequestHandler(yubikey, webSocket, listener, testScope)
    }

    // --- Helpers ---

    private fun makeSignRequest(
        requestId: String = "req-1",
        messageType: Int = 13,
        context: String = "Sign for git push to github.com:user/repo.git",
        data: String = Base64.getEncoder().encodeToString(byteArrayOf(0x0D, 0x01, 0x02, 0x03))
    ) = SignRequest(
        requestId = requestId,
        messageType = messageType,
        context = context,
        data = data
    )

    private fun makeListKeysRequest(requestId: String = "req-list") = SignRequest(
        requestId = requestId,
        messageType = 11,
        context = "List SSH keys",
        data = Base64.getEncoder().encodeToString(byteArrayOf(0x0B))
    )

    // --- Request queuing ---

    @Test
    fun `second sign request waits until first completes`() = testScope.runTest {
        // First sign will block until we complete it
        val firstSignDeferred = CompletableDeferred<ByteArray>()
        coEvery { yubikey.hasCachedPin() } returns true
        coEvery { yubikey.sign(any(), any()) } coAnswers {
            firstSignDeferred.await()
        }

        handler.onSignRequest(makeSignRequest(requestId = "req-1"))
        // Use runCurrent() to dispatch coroutine without advancing virtual time past withTimeout
        runCurrent()

        // First request should show dialog
        verify(exactly = 1) { listener.onShowSignDialog(any(), any(), any(), any()) }

        // Second request arrives while first is pending
        handler.onSignRequest(makeSignRequest(requestId = "req-2"))
        runCurrent()

        // Still only one dialog shown (second is queued)
        verify(exactly = 1) { listener.onShowSignDialog(any(), any(), any(), any()) }

        // Complete first sign
        firstSignDeferred.complete(byteArrayOf(0x01, 0x02))
        advanceUntilIdle()

        // Now second dialog should appear
        verify(exactly = 2) { listener.onShowSignDialog(any(), any(), any(), any()) }
    }

    // --- Cancel ---

    @Test
    fun `cancel sends ssh-agent-cancel message`() = testScope.runTest {
        coEvery { yubikey.hasCachedPin() } returns true
        coEvery { yubikey.sign(any(), any()) } coAnswers {
            // Block forever (until cancelled)
            CompletableDeferred<ByteArray>().await()
        }

        handler.onSignRequest(makeSignRequest(requestId = "req-1"))
        advanceUntilIdle()

        handler.onCancel()
        advanceUntilIdle()

        verify { webSocket.sendCancel("req-1") }
        verify { listener.onDismissDialog() }
    }

    // --- Timeout ---

    @Test
    fun `sign request times out and sends cancel`() = testScope.runTest {
        coEvery { yubikey.hasCachedPin() } returns true
        coEvery { yubikey.sign(any(), any()) } coAnswers {
            // Block forever (simulating no Yubikey touch)
            CompletableDeferred<ByteArray>().await()
        }

        handler.onSignRequest(makeSignRequest(requestId = "req-timeout"))
        advanceUntilIdle()

        // Advance past the timeout period (60 seconds per spec)
        testScheduler.advanceTimeBy(61_000)
        advanceUntilIdle()

        verify { webSocket.sendCancel("req-timeout") }
        verify { listener.onDismissDialog() }
    }

    // --- Yubikey disconnect ---

    @Test
    fun `Yubikey disconnected during signing sends cancel`() = testScope.runTest {
        coEvery { yubikey.hasCachedPin() } returns true
        coEvery { yubikey.sign(any(), any()) } coAnswers {
            CompletableDeferred<ByteArray>().await()
        }

        handler.onSignRequest(makeSignRequest(requestId = "req-dc"))
        advanceUntilIdle()

        // Simulate Yubikey disconnect
        handler.onYubikeyDisconnected()
        advanceUntilIdle()

        verify { webSocket.sendCancel("req-dc") }
        verify { listener.onDismissDialog() }
    }

    // --- messageType 11 (list keys) auto-respond ---

    @Test
    fun `messageType 11 auto-responds with keys without showing dialog`() = testScope.runTest {
        val testKeys = listOf(
            SshPublicKey(
                blob = byteArrayOf(0x01, 0x02, 0x03),
                comment = "YubiKey PIV Slot 9a"
            )
        )
        coEvery { yubikey.listKeys() } returns testKeys

        handler.onSignRequest(makeListKeysRequest(requestId = "req-list"))
        advanceUntilIdle()

        // Should NOT show dialog for list keys
        verify(exactly = 0) { listener.onShowSignDialog(any(), any(), any(), any()) }

        // Should send response via WebSocket
        verify { webSocket.sendResponse(eq("req-list"), any()) }

        // Should have called listKeys on YubikeyManager
        coVerify { yubikey.listKeys() }
    }

    // --- PIN handling ---

    @Test
    fun `PIN prompt shown on first sign when no cached PIN`() = testScope.runTest {
        coEvery { yubikey.hasCachedPin() } returns false

        handler.onSignRequest(makeSignRequest(requestId = "req-pin"))
        advanceUntilIdle()

        // Dialog should show with pinRequired = true
        verify { listener.onShowSignDialog(any(), eq(true), any(), any()) }
    }

    @Test
    fun `PIN cached after successful verification - no re-prompt`() = testScope.runTest {
        // First request: no cached PIN
        coEvery { yubikey.hasCachedPin() } returns false
        coEvery { yubikey.sign(any(), any()) } returns byteArrayOf(0x01, 0x02)

        handler.onSignRequest(makeSignRequest(requestId = "req-1"))
        // Use runCurrent() to dispatch coroutine without advancing past withTimeout
        runCurrent()

        // Dialog shows with PIN required
        verify { listener.onShowSignDialog(any(), eq(true), any(), any()) }

        // User enters PIN
        handler.onPinEntered("123456".toCharArray())
        advanceUntilIdle()

        // Sign succeeds, response sent
        verify { webSocket.sendResponse(eq("req-1"), any()) }

        // Second request: PIN now cached
        clearMocks(listener, answers = false)
        coEvery { yubikey.hasCachedPin() } returns true

        handler.onSignRequest(makeSignRequest(requestId = "req-2"))
        runCurrent()

        // Dialog should show with pinRequired = false (PIN cached)
        verify { listener.onShowSignDialog(any(), eq(false), any(), any()) }
    }

    @Test
    fun `wrong PIN shows error with retries remaining`() = testScope.runTest {
        coEvery { yubikey.hasCachedPin() } returns false
        coEvery { yubikey.sign(any(), any()) } throws WrongPinException(2)

        handler.onSignRequest(makeSignRequest(requestId = "req-wrong-pin"))
        // Use runCurrent() to dispatch coroutine without advancing past withTimeout
        runCurrent()

        // User enters wrong PIN
        handler.onPinEntered("000000".toCharArray())
        runCurrent()

        // Should show PIN error with retries remaining
        verify { listener.onPinError(any(), eq(2)) }

        // Should NOT send cancel (user can retry)
        verify(exactly = 0) { webSocket.sendCancel(any()) }
    }

    @Test
    fun `PIN blocked shows locked error and cancels request`() = testScope.runTest {
        coEvery { yubikey.hasCachedPin() } returns false
        coEvery { yubikey.sign(any(), any()) } throws PinBlockedException(
            "PIN is blocked. Use ykman piv access unblock-pin to recover."
        )

        handler.onSignRequest(makeSignRequest(requestId = "req-blocked"))
        // Use runCurrent() to dispatch coroutine without advancing past withTimeout
        runCurrent()

        // User enters PIN (but it's blocked)
        handler.onPinEntered("123456".toCharArray())
        advanceUntilIdle()

        // Should show blocked error
        verify { listener.onPinBlocked(any()) }

        // Should auto-cancel the request
        verify { webSocket.sendCancel("req-blocked") }
        verify { listener.onDismissDialog() }
    }
}
