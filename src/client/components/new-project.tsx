import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { post } from '../lib/api.js';
import { connectSession, type ServerMessage, type OutputMessage, type StateMessage, type PhaseMessage } from '../lib/ws.js';
import { navigate } from '../lib/router.js';
import { transcribe, getVoiceState, onVoiceStateChange, type VoiceState } from '../lib/voice.js';

const PHASES = ['specify', 'clarify', 'plan', 'tasks', 'analyze'] as const;

type WorkflowResponse = {
  sessionId: string;
  projectId: string;
  phase: string;
  state: string;
};

type LogEntry = {
  ts: number;
  stream: 'stdout' | 'stderr' | 'system';
  seq: number;
  content: string;
};

const phaseLabel: Record<string, string> = {
  specify: 'Specify',
  clarify: 'Clarify',
  plan: 'Plan',
  tasks: 'Tasks',
  analyze: 'Analyze',
  implementation: 'Implementing',
};

export function NewProject() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Workflow state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<string | null>(null);
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  const [userInput, setUserInput] = useState('');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');

  const outputRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const wsRef = useRef<ReturnType<typeof connectSession> | null>(null);

  // Track voice state changes
  useEffect(() => {
    return onVoiceStateChange(setVoiceState);
  }, []);

  // Auto-scroll output
  useEffect(() => {
    if (autoScrollRef.current && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  // Connect to session WebSocket when sessionId changes
  useEffect(() => {
    if (!sessionId) return;

    // Close previous connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const client = connectSession(sessionId, (msg: ServerMessage) => {
      if (msg.type === 'output') {
        const out = msg as OutputMessage;
        setLines((prev) => {
          if (prev.length > 0 && prev[prev.length - 1]!.seq >= out.seq) return prev;
          return [...prev, { ts: out.ts, stream: out.stream, seq: out.seq, content: out.content }];
        });
      } else if (msg.type === 'state') {
        const state = msg as StateMessage;
        setSessionState(state.state);
        if (state.state === 'waiting-for-input' && state.question) {
          setQuestion(state.question);
        } else {
          setQuestion(null);
        }
        if (state.state === 'completed') {
          // Check if this is the final phase (implementation started)
          // The phase message will update us; completed during implementation means done
        }
      } else if (msg.type === 'phase') {
        const phase = msg as PhaseMessage;
        setCurrentPhase(phase.phase);
        if (phase.phase === 'implementation') {
          // Workflow complete — implementation kicked off
          setTimeout(() => navigate('/'), 2000);
        }
        // Connect to the new session for this phase
        if (phase.sessionId !== sessionId) {
          setSessionId(phase.sessionId);
        }
      }
    });

    wsRef.current = client;
    return () => client.close();
  }, [sessionId]);

  const startWorkflow = useCallback(async () => {
    if (!name.trim() || !description.trim() || starting) return;
    setStarting(true);
    setError(null);

    try {
      const result = await post<WorkflowResponse>('/workflows/new-project', {
        name: name.trim(),
        description: description.trim(),
      });
      setSessionId(result.sessionId);
      setCurrentPhase(result.phase);
      setSessionState(result.state);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start workflow');
      setStarting(false);
    }
  }, [name, description, starting]);

  const sendInput = useCallback(() => {
    if (!userInput.trim() || !wsRef.current) return;
    wsRef.current.send({ type: 'input', content: userInput.trim() });
    // Add user message to output
    setLines((prev) => [
      ...prev,
      { ts: Date.now(), stream: 'system' as const, seq: prev.length + 10000, content: `> ${userInput.trim()}` },
    ]);
    setUserInput('');
    setQuestion(null);
  }, [userInput]);

  const handleVoice = useCallback(async () => {
    try {
      const text = await transcribe();
      if (text) {
        setUserInput(text);
      }
    } catch {
      // Voice failed — user can type instead
    }
  }, []);

  const handleScroll = () => {
    if (!outputRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40;
  };

  // Phase indicator
  const phaseIndex = currentPhase ? PHASES.indexOf(currentPhase as typeof PHASES[number]) : -1;

  // If workflow hasn't started, show the form
  if (!sessionId) {
    return (
      <div>
        <h2 style={{ margin: '0 0 16px 0', fontSize: '1.2rem' }}>New Project</h2>

        {error && (
          <div style={{ color: '#f44336', marginBottom: '12px', fontSize: '0.85rem' }}>{error}</div>
        )}

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: '4px' }}>
            Repository name
          </label>
          <input
            type="text"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            placeholder="my-project"
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: '4px',
              border: '1px solid #555',
              background: '#1a1a2e',
              color: '#ddd',
              fontSize: '0.9rem',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: '4px' }}>
            Describe your idea
          </label>
          <div style={{ position: 'relative' }}>
            <textarea
              value={description}
              onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
              placeholder="Describe what you want to build..."
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
              title="Speak your idea"
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
          disabled={starting || !name.trim() || !description.trim()}
          style={{
            padding: '10px 24px',
            background: starting || !name.trim() || !description.trim() ? '#555' : '#7c8dff',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: starting || !name.trim() || !description.trim() ? 'default' : 'pointer',
            fontSize: '0.9rem',
          }}
        >
          {starting ? 'Starting...' : 'Start Project'}
        </button>
      </div>
    );
  }

  // Workflow in progress — show phase indicator + chat view
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
      {/* Phase indicator */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        {PHASES.map((phase, i) => {
          const isActive = phase === currentPhase;
          const isDone = phaseIndex > i;
          return (
            <div key={phase} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {i > 0 && <span style={{ color: '#555', fontSize: '0.7rem' }}>&rarr;</span>}
              <span
                style={{
                  fontSize: '0.75rem',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: isActive ? '#7c8dff' : isDone ? '#4caf50' : '#333',
                  color: isActive || isDone ? '#fff' : '#888',
                  fontWeight: isActive ? 'bold' : 'normal',
                }}
              >
                {phaseLabel[phase] ?? phase}
              </span>
            </div>
          );
        })}
        {currentPhase === 'implementation' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ color: '#555', fontSize: '0.7rem' }}>&rarr;</span>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '2px 8px',
                borderRadius: '4px',
                background: '#4caf50',
                color: '#fff',
                fontWeight: 'bold',
              }}
            >
              Implementing
            </span>
          </div>
        )}
      </div>

      {/* Session state */}
      {sessionState && (
        <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '8px' }}>
          Phase: {phaseLabel[currentPhase ?? ''] ?? currentPhase} — {sessionState}
        </div>
      )}

      {/* Terminal output */}
      <div
        ref={outputRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflow: 'auto',
          background: '#0d0d1a',
          borderRadius: '8px',
          border: '1px solid #333',
          padding: '8px 12px',
          fontFamily: 'monospace',
          fontSize: '0.8rem',
          lineHeight: '1.5',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {lines.map((entry) => (
          <div
            key={entry.seq}
            style={{
              color: entry.stream === 'stderr' ? '#f44336' : entry.stream === 'system' ? '#7c8dff' : '#ccc',
            }}
          >
            {entry.stream === 'system' ? (
              <span style={{ fontStyle: 'italic' }}>{entry.content}</span>
            ) : (
              entry.content
            )}
          </div>
        ))}
        {lines.length === 0 && (
          <div style={{ color: '#666' }}>Waiting for output...</div>
        )}
      </div>

      {/* Input area — shown for interview sessions when the agent is running or waiting */}
      <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={userInput}
          onInput={(e) => setUserInput((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendInput();
            }
          }}
          placeholder={question ? 'Type your answer...' : 'Type a message...'}
          style={{
            flex: 1,
            padding: '10px 12px',
            borderRadius: '4px',
            border: '1px solid #555',
            background: '#1a1a2e',
            color: '#ddd',
            fontSize: '0.85rem',
            outline: 'none',
          }}
        />
        <button
          onClick={handleVoice}
          disabled={voiceState !== 'idle'}
          title="Voice input"
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: 'none',
            background: voiceState === 'listening' ? '#f44336' : voiceState === 'processing' ? '#ff9800' : '#333',
            color: '#fff',
            cursor: voiceState !== 'idle' ? 'default' : 'pointer',
            fontSize: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {voiceState === 'listening' ? '...' : voiceState === 'processing' ? '~' : 'M'}
        </button>
        <button
          onClick={sendInput}
          disabled={!userInput.trim()}
          style={{
            padding: '10px 16px',
            borderRadius: '4px',
            border: 'none',
            background: !userInput.trim() ? '#555' : '#7c8dff',
            color: '#fff',
            cursor: !userInput.trim() ? 'default' : 'pointer',
            fontSize: '0.85rem',
            flexShrink: 0,
          }}
        >
          Send
        </button>
      </div>

      {/* Question banner */}
      {question && (
        <div
          style={{
            marginTop: '8px',
            padding: '8px 12px',
            background: '#332800',
            border: '1px solid #ff9800',
            borderRadius: '4px',
            fontSize: '0.85rem',
            color: '#ff9800',
          }}
        >
          {question}
        </div>
      )}
    </div>
  );
}
