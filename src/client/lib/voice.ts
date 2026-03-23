export type VoiceBackend = 'browser' | 'cloud';

export type VoiceState = 'idle' | 'listening' | 'processing';

export type VoiceListener = (state: VoiceState) => void;

/**
 * Voice input module supporting browser-native Web Speech API
 * and Google Speech-to-Text cloud backend (via /api/voice/transcribe).
 */

let currentBackend: VoiceBackend = 'browser';
let stateListeners: VoiceListener[] = [];
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

    recognition.onstart = () => setState('listening');

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        }
      }
    };

    recognition.onerror = (event: any) => {
      setState('idle');
      reject(new Error(`Speech recognition error: ${event.error}`));
    };

    recognition.onend = () => {
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

    recognition.onstart = () => setState('listening');

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        }
      }
    };

    recognition.onerror = (event: any) => {
      activeRecognition = null;
      setState('idle');
      reject(new Error(`Speech recognition error: ${event.error}`));
    };

    recognition.onend = () => {
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
