// SSH Agent Bridge — stub for TDD (T008)
// Real implementation will be added in T013

import type net from 'node:net';

export interface BridgeRequest {
  requestId: string;
  messageType: number;
  context: string;
  data: string; // base64
}

export interface CreateBridgeOptions {
  sessionId: string;
  socketPath: string;
  remoteContext: string;
  onRequest: (req: BridgeRequest) => void;
  timeoutMs?: number; // default 60000
}

export interface SSHAgentBridge {
  sessionId: string;
  socketPath: string;
  handleResponse(requestId: string, data: Buffer): void;
  handleCancel(requestId: string): void;
  destroy(): Promise<void>;
}

export async function createBridge(_options: CreateBridgeOptions): Promise<SSHAgentBridge> {
  throw new Error('createBridge not implemented — waiting for T013');
}
