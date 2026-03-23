import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { get, post } from '../lib/api.js';
import { connectSession, type ServerMessage, type OutputMessage, type StateMessage } from '../lib/ws.js';

type SessionMeta = {
  id: string;
  projectId: string;
  type: string;
  state: string;
  startedAt: string;
  endedAt: string | null;
  pid: number | null;
  question: string | null;
  lastTaskId: string | null;
};

type LogEntry = {
  ts: number;
  stream: 'stdout' | 'stderr' | 'system';
  seq: number;
  content: string;
};

const streamColor: Record<string, string> = {
  stdout: '#ccc',
  stderr: '#f44336',
  system: '#7c8dff',
};

const stateColor: Record<string, string> = {
  running: '#4caf50',
  'waiting-for-input': '#ff9800',
  completed: '#666',
  failed: '#f44336',
};

type PushState = 'unknown' | 'unsupported' | 'denied' | 'prompt' | 'subscribed' | 'subscribing' | 'error';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function SessionView({ id }: { id: string }) {
  const [session, setSession] = useState<SessionMeta | null>(null);
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const outputRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const [pushState, setPushState] = useState<PushState>('unknown');

  // Fetch session metadata
  useEffect(() => {
    get<SessionMeta>(`/sessions/${id}`)
      .then((data) => {
        setSession(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  // Connect to WebSocket for live output
  useEffect(() => {
    if (!session) return;

    // Load existing log first
    get<LogEntry[]>(`/sessions/${id}/log`)
      .then((entries) => {
        setLines(entries);
      })
      .catch(() => {
        // Non-fatal — we'll get live output via WS
      });

    const lastSeq = 0; // Start from beginning; log fetch covers history
    const client = connectSession(id, (msg: ServerMessage) => {
      if (msg.type === 'output') {
        const out = msg as OutputMessage;
        setLines((prev) => {
          // Deduplicate by seq
          if (prev.length > 0 && prev[prev.length - 1]!.seq >= out.seq) return prev;
          return [...prev, { ts: out.ts, stream: out.stream, seq: out.seq, content: out.content }];
        });
      } else if (msg.type === 'state') {
        const state = msg as StateMessage;
        setSession((prev) =>
          prev ? { ...prev, state: state.state, question: state.question ?? null } : prev,
        );
      }
    }, lastSeq);

    return () => client.close();
  }, [session?.id]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScrollRef.current && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  // Check push notification state
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setPushState('denied');
      return;
    }

    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setPushState(sub ? 'subscribed' : 'prompt');
      });
    });
  }, []);

  const subscribePush = useCallback(async () => {
    if (pushState !== 'prompt') return;
    setPushState('subscribing');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setPushState('denied');
        return;
      }
      const { publicKey } = await get<{ publicKey: string }>('/push/vapid-key');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = sub.toJSON();
      await post('/push/subscribe', {
        endpoint: json.endpoint,
        keys: json.keys,
      });
      setPushState('subscribed');
    } catch {
      setPushState('error');
    }
  }, [pushState]);

  const handleScroll = () => {
    if (!outputRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40;
  };

  if (loading) return <div>Loading session...</div>;
  if (error && !session) return <div style={{ color: '#f44336' }}>Error: {error}</div>;
  if (!session) return <div style={{ color: '#f44336' }}>Session not found</div>;

  const color = stateColor[session.state] ?? '#666';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
      {/* Session header */}
      <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: '0.85rem', color: '#aaa' }}>{session.type}</span>
          <span
            style={{
              fontSize: '0.75rem',
              padding: '2px 8px',
              borderRadius: '4px',
              background: color,
              color: '#fff',
              marginLeft: '8px',
            }}
          >
            {session.state}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.8rem', color: '#666' }}>
            {new Date(session.startedAt).toLocaleString()}
          </span>
          {pushState === 'prompt' && (
            <button
              onClick={subscribePush}
              style={{
                fontSize: '0.75rem',
                padding: '2px 8px',
                borderRadius: '4px',
                border: '1px solid #7c8dff',
                background: 'transparent',
                color: '#7c8dff',
                cursor: 'pointer',
              }}
            >
              Enable notifications
            </button>
          )}
          {pushState === 'subscribing' && (
            <span style={{ fontSize: '0.75rem', color: '#888' }}>Subscribing...</span>
          )}
          {pushState === 'subscribed' && (
            <span style={{ fontSize: '0.75rem', color: '#4caf50' }}>Notifications on</span>
          )}
          {pushState === 'denied' && (
            <span style={{ fontSize: '0.75rem', color: '#f44336' }}>Notifications blocked</span>
          )}
          {pushState === 'error' && (
            <span style={{ fontSize: '0.75rem', color: '#f44336' }}>Notification error</span>
          )}
        </div>
      </div>

      {/* Question banner for waiting-for-input */}
      {session.state === 'waiting-for-input' && session.question && (
        <div
          style={{
            padding: '12px',
            marginBottom: '12px',
            background: '#332800',
            border: '1px solid #ff9800',
            borderRadius: '8px',
            fontSize: '0.9rem',
          }}
        >
          <div style={{ fontWeight: 'bold', color: '#ff9800', marginBottom: '4px' }}>
            Input needed{session.lastTaskId ? ` (Task ${session.lastTaskId})` : ''}
          </div>
          <div style={{ color: '#ddd' }}>{session.question}</div>
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
          <div key={entry.seq} style={{ color: streamColor[entry.stream] ?? '#ccc' }}>
            {entry.stream === 'system' ? (
              <span style={{ fontStyle: 'italic' }}>[{entry.stream}] {entry.content}</span>
            ) : (
              entry.content
            )}
          </div>
        ))}
        {lines.length === 0 && (
          <div style={{ color: '#666' }}>
            {session.state === 'running' ? 'Waiting for output...' : 'No output'}
          </div>
        )}
      </div>
    </div>
  );
}
