import { createLogger } from '../lib/logger.js';

const log = createLogger('disk-monitor');

export interface DiskMonitor {
  start(): void;
  stop(): void;
  checkNow(): Promise<void>;
}

export interface DiskMonitorOptions {
  dataDir: string;
  thresholdMb: number;
  _statfs?: (path: string, cb: (err: NodeJS.ErrnoException | null, stats: { bavail: bigint; bsize: bigint }) => void) => void;
  _sendWarning?: (availableMb: number) => Promise<void>;
}

export function createDiskMonitor(_opts: DiskMonitorOptions): DiskMonitor {
  // Stub — to be implemented in T065c
  throw new Error('Not implemented');
}
