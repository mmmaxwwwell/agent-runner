import { statfs } from 'node:fs';
import { createLogger } from '../lib/logger.js';

const log = createLogger('disk-monitor');

export interface DiskMonitor {
  start(): void;
  stop(): void;
  checkNow(): Promise<void>;
}

type StatfsCb = (err: NodeJS.ErrnoException | null, stats: { bavail: bigint; bsize: bigint }) => void;

export interface DiskMonitorOptions {
  dataDir: string;
  thresholdMb: number;
  _statfs?: (path: string, cb: StatfsCb) => void;
  _sendWarning?: (availableMb: number) => Promise<void>;
}

export function createDiskMonitor(opts: DiskMonitorOptions): DiskMonitor {
  const { dataDir, thresholdMb } = opts;
  const checkStatfs = opts._statfs ?? ((path: string, cb: StatfsCb) => statfs(path, { bigint: true }, cb));
  const sendWarning = opts._sendWarning ?? (async () => {});

  let intervalId: ReturnType<typeof setInterval> | null = null;
  let warned = false;

  function getAvailableMb(): Promise<number> {
    return new Promise((resolve, reject) => {
      checkStatfs(dataDir, (err, stats) => {
        if (err) return reject(err);
        const availableBytes = stats.bavail * stats.bsize;
        resolve(Number(availableBytes / (1024n * 1024n)));
      });
    });
  }

  async function checkNow(): Promise<void> {
    try {
      const availableMb = await getAvailableMb();
      if (availableMb < thresholdMb) {
        if (!warned) {
          warned = true;
          log.warn({ availableMb, thresholdMb, dataDir }, 'Disk space low');
          await sendWarning(availableMb);
        }
      } else {
        warned = false;
      }
    } catch (err) {
      log.error({ err, dataDir }, 'Failed to check disk space');
    }
  }

  return {
    start() {
      if (intervalId) return;
      intervalId = setInterval(() => { checkNow(); }, 60_000);
    },
    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    checkNow,
  };
}
