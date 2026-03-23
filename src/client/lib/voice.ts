export type VoiceBackend = 'browser' | 'cloud';

export type VoiceState = 'idle' | 'listening' | 'processing';

export type VoiceListener = (state: VoiceState) => void;
export type InterimResultListener = (interim: string) => void;

/**
 * Voice input module supporting browser-native Web Speech API
 * and Google Speech-to-Text cloud backend (via /api/voice/transcribe).
 */

const SILENCE_TIMEOUT_MS = 5000;

let currentBackend: VoiceBackend = 'browser';
let stateListeners: VoiceListener[] = [];
let interimListeners: InterimResultListener[] = [];
let currentState: VoiceState = 'idle';

function setState(state: VoiceState) {
  currentState = state;
  for (const listener of stateListeners) {
    listener(state);
  }
}

export function getVoiceState(): VoiceState {
  return currentState;
}

export function onVoiceStateChange(listener: VoiceListener): () => void {
  stateListeners.push(listener);
  return () => {
    stateListeners = stateListeners.filter((l) => l !== listener);
  };
}

export function onInterimResult(listener: InterimResultListener): () => void {
  interimListeners.push(listener);
  return () => {
    interimListeners = interimListeners.filter((l) => l !== listener);
  };
}

function emitInterimResult(text: string) {
  for (const listener of interimListeners) {
    listener(text);
  }
}

export function setBackend(backend: VoiceBackend): void {
  currentBackend = backend;
}

export function getBackend(): VoiceBackend {
  return currentBackend;
}

export function isBrowserSpeechAvailable(): boolean {
  return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

/**
 * Start listening and return the transcribed text.
 * Uses the currently selected backend.
 */
export function transcribe(): Promise<string> {
  if (currentBackend === 'browser') {
    return transcribeBrowser();
  }
  return transcribeCloud();
}

function transcribeBrowser(): Promise<string> {
  return new Promise((resolve, reject) => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      reject(new Error('Browser speech recognition is not available'));
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    const resetSilenceTimer = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => recognition.stop(), SILENCE_TIMEOUT_MS);
    };

    recognition.onstart = () => {
      setState('listening');
      resetSilenceTimer();
    };

    recognition.onresult = (event: any) => {
      resetSilenceTimer();
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }
      emitInterimResult(finalTranscript + interimTranscript);
    };

    recognition.onerror = (event: any) => {
      if (silenceTimer) clearTimeout(silenceTimer);
      setState('idle');
      reject(new Error(`Speech recognition error: ${event.error}`));
    };

    recognition.onend = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      setState('idle');
      resolve(finalTranscript);
    };

    recognition.start();
  });
}

async function transcribeCloud(): Promise<string> {
  setState('listening');

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mediaRecorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];

  const audioBlob = await new Promise<Blob>((resolve) => {
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      resolve(new Blob(chunks, { type: mediaRecorder.mimeType }));
    };

    mediaRecorder.start();

    // Stop after silence detection or max 30 seconds
    // For simplicity, use a fixed timeout — the user can also call stopListening()
    setTimeout(() => {
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    }, 30000);
  });

  setState('processing');

  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');

  const res = await fetch('/api/voice/transcribe', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    setState('idle');
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error ?? 'Voice transcription failed');
  }

  const data = await res.json();
  setState('idle');
  return data.text;
}

// Reference to active MediaRecorder for external stop control
let activeRecorder: MediaRecorder | null = null;
let activeRecognition: any = null;

/**
 * Start listening. Returns a promise that resolves with the transcribed text
 * when stopListening() is called or the speech ends naturally.
 */
export function startListening(): Promise<string> {
  if (currentBackend === 'browser') {
    return startListeningBrowser();
  }
  return startListeningCloud();
}

function startListeningBrowser(): Promise<string> {
  return new Promise((resolve, reject) => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      reject(new Error('Browser speech recognition is not available'));
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    activeRecognition = recognition;

    let finalTranscript = '';
    let silenceTimer: ReturnType<typeof setTimeout> | null = null;

    const resetSilenceTimer = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => recognition.stop(), SILENCE_TIMEOUT_MS);
    };

    recognition.onstart = () => {
      setState('listening');
      resetSilenceTimer();
    };

    recognition.onresult = (event: any) => {
      resetSilenceTimer();
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }
      emitInterimResult(finalTranscript + interimTranscript);
    };

    recognition.onerror = (event: any) => {
      if (silenceTimer) clearTimeout(silenceTimer);
      activeRecognition = null;
      setState('idle');
      reject(new Error(`Speech recognition error: ${event.error}`));
    };

    recognition.onend = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      activeRecognition = null;
      setState('idle');
      resolve(finalTranscript);
    };

    recognition.start();
  });
}

async function startListeningCloud(): Promise<string> {
  setState('listening');

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mediaRecorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  activeRecorder = mediaRecorder;

  const audioBlob = await new Promise<Blob>((resolve) => {
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      activeRecorder = null;
      stream.getTracks().forEach((track) => track.stop());
      resolve(new Blob(chunks, { type: mediaRecorder.mimeType }));
    };

    mediaRecorder.start();
  });

  setState('processing');

  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');

  const res = await fetch('/api/voice/transcribe', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    setState('idle');
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(data.error ?? 'Voice transcription failed');
  }

  const data = await res.json();
  setState('idle');
  return data.text;
}

/**
 * Toggle listening on/off. If idle, starts listening and returns a promise
 * that resolves with transcribed text. If already listening, stops recognition
 * and the original promise resolves with accumulated text.
 * Returns null when stopping (the start call's promise delivers the text).
 */
let activeTogglePromise: Promise<string> | null = null;

export function toggleListening(): Promise<string> | null {
  if (currentState === 'listening') {
    stopListening();
    return null;
  }
  activeTogglePromise = startListening();
  activeTogglePromise.finally(() => { activeTogglePromise = null; });
  return activeTogglePromise;
}

/**
 * Stop an active listening session. For browser mode, stops recognition.
 * For cloud mode, stops the MediaRecorder to trigger transcription.
 */
export function stopListening(): void {
  if (activeRecognition) {
    activeRecognition.stop();
    activeRecognition = null;
  }
  if (activeRecorder && activeRecorder.state === 'recording') {
    activeRecorder.stop();
  }
}
