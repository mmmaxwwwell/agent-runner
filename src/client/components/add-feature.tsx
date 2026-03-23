import { useState, useEffect, useCallback } from 'preact/hooks';
import { post } from '../lib/api.js';
import { transcribe, onVoiceStateChange, type VoiceState } from '../lib/voice.js';
import { SpecKitChat } from './spec-kit-chat.js';

type WorkflowResponse = {
  sessionId: string;
  projectId: string;
  phase: string;
  state: string;
};

export function AddFeature({ projectId }: { projectId: string }) {
  const [description, setDescription] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Workflow state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');

  useEffect(() => {
    return onVoiceStateChange(setVoiceState);
  }, []);

  const startWorkflow = useCallback(async () => {
    if (!description.trim() || starting) return;
    setStarting(true);
    setError(null);

    try {
      const result = await post<WorkflowResponse>(`/projects/${projectId}/add-feature`, {
        description: description.trim(),
      });
      setSessionId(result.sessionId);
      setCurrentPhase(result.phase);
      setSessionState(result.state);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start workflow');
      setStarting(false);
    }
  }, [description, starting, projectId]);

  const handleVoice = useCallback(async () => {
    try {
      const text = await transcribe();
      if (text) {
        setDescription(text);
      }
    } catch {
      // Voice failed — user can type instead
    }
  }, []);

  // If workflow hasn't started, show the form
  if (!sessionId) {
    return (
      <div>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '1.2rem' }}>Add Feature</h2>

        {error && (
          <div style={{ color: '#f44336', marginBottom: '12px', fontSize: '0.85rem' }}>{error}</div>
        )}

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: '4px' }}>
            Describe the feature
          </label>
          <div style={{ position: 'relative' }}>
            <textarea
              value={description}
              onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
              placeholder="Describe the feature you want to add..."
              rows={4}
              style={{
                width: '100%',
                padding: '10px 12px',
                paddingRight: '44px',
                borderRadius: '4px',
                border: '1px solid #555',
                background: '#1a1a2e',
                color: '#ddd',
                fontSize: '0.9rem',
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
            <button
              onClick={handleVoice}
              disabled={voiceState !== 'idle'}
              title="Speak your feature idea"
              style={{
                position: 'absolute',
                right: '8px',
                top: '8px',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                border: 'none',
                background: voiceState === 'listening' ? '#f44336' : voiceState === 'processing' ? '#ff9800' : '#333',
                color: '#fff',
                cursor: voiceState !== 'idle' ? 'default' : 'pointer',
                fontSize: '1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {voiceState === 'listening' ? '...' : voiceState === 'processing' ? '~' : 'M'}
            </button>
          </div>
        </div>

        <button
          onClick={startWorkflow}
          disabled={starting || !description.trim()}
          style={{
            padding: '10px 24px',
            background: starting || !description.trim() ? '#555' : '#7c8dff',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: starting || !description.trim() ? 'default' : 'pointer',
            fontSize: '0.9rem',
          }}
        >
          {starting ? 'Starting...' : 'Add Feature'}
        </button>
      </div>
    );
  }

  // Workflow in progress — use shared spec-kit chat component
  return (
    <SpecKitChat
      sessionId={sessionId}
      initialPhase={currentPhase ?? 'specify'}
      initialState={sessionState ?? 'running'}
      completionRoute={`/projects/${projectId}`}
    />
  );
}
