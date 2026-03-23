/** WebSocket message types from server (websocket-api.md) */
export type OutputMessage = {
  type: 'output';
  seq: number;
  ts: number;
  stream: 'stdout' | 'stderr' | 'system';
  content: string;
};

export type StateMessage = {
  type: 'state';
  state: string;
  question?: string;
  taskId?: string;
};

export type ProgressMessage = {
  type: 'progress';
  taskSummary: {
    total: number;
    completed: number;
    blocked: number;
    skipped: number;
    remaining: number;
  };
};

export type SyncMessage = {
  type: 'sync';
  lastSeq: number;
};

export type PhaseMessage = {
  type: 'phase';
  workflow: 'new-project' | 'add-feature';
  phase: string;
  previousPhase: string | null;
  iteration: number;
  maxIterations: number;
  sessionId: string;
};

export type ErrorMessage = {
  type: 'error';
  message: string;
};

export type ProjectUpdateMessage = {
  type: 'project-update';
  projectId: string;
  activeSession: { id: string; type: string; state: string } | null;
  taskSummary: {
    total: number;
    completed: number;
    blocked: number;
    skipped: number;
    remaining: number;
  };
  workflow: {
    type: string;
    phase: string;
    iteration: number;
    description: string;
  } | null;
};

export type ServerMessage =
  | OutputMessage
  | StateMessage
  | ProgressMessage
  | SyncMessage
  | PhaseMessage
  | ErrorMessage
  | ProjectUpdateMessage;

export type MessageHandler = (msg: ServerMessage) => void;

const MIN_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 30_000;

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private lastSeq = 0;
  private reconnectDelay = MIN_RECONNECT_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private path: string;
  private trackSeq: boolean;

  /**
   * @param path  WebSocket path, e.g. "/ws/sessions/abc" or "/ws/dashboard"
   * @param opts  Options — trackSeq enables lastSeq tracking for session streams
   */
  constructor(path: string, opts?: { trackSeq?: boolean; lastSeq?: number }) {
    this.path = path;
    this.trackSeq = opts?.trackSeq ?? false;
    if (opts?.lastSeq !== undefined) this.lastSeq = opts.lastSeq;
    this.connect();
  }

  /** Register a handler for incoming messages. */
  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  /** Send a JSON message to the server (e.g. input for interview sessions). */
  send(msg: { type: string; [key: string]: unknown }): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** Permanently close the connection (no reconnect). */
  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private connect(): void {
    if (this.closed) return;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url = `${proto}//${location.host}${this.path}`;
    if (this.trackSeq && this.lastSeq > 0) {
      url += `?lastSeq=${this.lastSeq}`;
    }

    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = MIN_RECONNECT_MS;
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }

      // Track sequence numbers for replay on reconnect
      if (this.trackSeq && msg.type === 'output') {
        this.lastSeq = (msg as OutputMessage).seq;
      }

      for (const handler of this.handlers) {
        handler(msg);
      }
    };

    ws.onclose = () => {
      this.ws = null;
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after onerror, which triggers reconnect
    };
  }

  private scheduleReconnect(): void {
    if (this.closed) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);

    // Exponential backoff with cap
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_MS);
  }
}

/** Connect to a session stream with seq tracking and auto-reconnect. */
export function connectSession(
  sessionId: string,
  handler: MessageHandler,
  lastSeq?: number,
): WsClient {
  const client = new WsClient(`/ws/sessions/${sessionId}`, {
    trackSeq: true,
    lastSeq,
  });
  client.onMessage(handler);
  return client;
}

/** Connect to the dashboard stream with auto-reconnect. */
export function connectDashboard(handler: MessageHandler): WsClient {
  const client = new WsClient('/ws/dashboard');
  client.onMessage(handler);
  return client;
}
