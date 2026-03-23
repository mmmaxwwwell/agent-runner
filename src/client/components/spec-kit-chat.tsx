import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { connectSession, type ServerMessage, type OutputMessage, type StateMessage, type PhaseMessage } from '../lib/ws.js';
import { transcribe, getVoiceState, onVoiceStateChange, type VoiceState } from '../lib/voice.js';
import { navigate } from '../lib/router.js';

const PHASES = ['specify', 'clarify', 'plan', 'tasks', 'analyze'] as const;

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

type SpecKitChatProps = {
  sessionId: string;
  initialPhase: string;
  initialState: string;
  /** Where to navigate on workflow completion */
  completionRoute: string;
};

export function SpecKitChat({ sessionId: initialSessionId, initialPhase, initialState, completionRoute }: SpecKitChatProps) {
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [currentPhase, setCurrentPhase] = useState<string | null>(initialPhase);
  const [sessionState, setSessionState] = useState<string | null>(initialState);
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
      } else if (msg.type === 'phase') {
        const phase = msg as PhaseMessage;
        setCurrentPhase(phase.phase);
        if (phase.phase === 'implementation') {
          setTimeout(() => navigate(completionRoute), 2000);
        }
        if (phase.sessionId !== sessionId) {
          setSessionId(phase.sessionId);
        }
      }
    });

    wsRef.current = client;
    return () => client.close();
  }, [sessionId, completionRoute]);

  const sendInput = useCallback(() => {
    if (!userInput.trim() || !wsRef.current) return;
    wsRef.current.send({ type: 'input', content: userInput.trim() });
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

  const phaseIndex = currentPhase ? PHASES.indexOf(currentPhase as typeof PHASES[number]) : -1;

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

      {/* Input area */}
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
