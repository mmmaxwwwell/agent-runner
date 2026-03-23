import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Types for the disk monitor module (to be implemented in T065c)
import {
  createDiskMonitor,
  type DiskMonitor,
  type DiskMonitorOptions,
} from '../../src/services/disk-monitor.ts';

describe('disk space monitor', () => {
  let timers: ReturnType<typeof setTimeout>[];

  beforeEach(() => {
    timers = [];
  });

  afterEach(() => {
    for (const t of timers) clearInterval(t);
    mock.restoreAll();
  });

  function makeMockStatfs(availableMb: number): DiskMonitorOptions['_statfs'] {
    const availableBytes = BigInt(availableMb) * 1024n * 1024n;
    return (_path: string, cb: (err: NodeJS.ErrnoException | null, stats: { bavail: bigint; bsize: bigint }) => void) => {
      cb(null, { bavail: availableBytes / 4096n, bsize: 4096n });
    };
  }

  function makeMockStatfsError(): DiskMonitorOptions['_statfs'] {
    return (_path: string, cb: (err: NodeJS.ErrnoException | null, stats: { bavail: bigint; bsize: bigint }) => void) => {
      cb(new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException, { bavail: 0n, bsize: 0n });
    };
  }

  describe('createDiskMonitor', () => {
    it('should create a disk monitor instance', () => {
      const monitor = createDiskMonitor({
        dataDir: '/tmp/test',
        thresholdMb: 8192,
        _statfs: makeMockStatfs(10000),
        _sendWarning: async () => {},
      });

      assert.ok(monitor, 'should return a disk monitor instance');
      assert.equal(typeof monitor.start, 'function');
      assert.equal(typeof monitor.stop, 'function');
      assert.equal(typeof monitor.checkNow, 'function');
    });
  });

  describe('warning triggers', () => {
    it('should trigger warning when available space falls below threshold', async () => {
      const warnings: number[] = [];
      const monitor = createDiskMonitor({
        dataDir: '/tmp/test',
        thresholdMb: 8192,
        _statfs: makeMockStatfs(5000), // 5000 MB < 8192 MB threshold
        _sendWarning: async (availableMb) => {
          warnings.push(availableMb);
        },
      });

      await monitor.checkNow();

      assert.equal(warnings.length, 1);
      assert.equal(warnings[0], 5000);
    });

    it('should NOT trigger warning when available space is above threshold', async () => {
      const warnings: number[] = [];
      const monitor = createDiskMonitor({
        dataDir: '/tmp/test',
        thresholdMb: 8192,
        _statfs: makeMockStatfs(10000), // 10000 MB > 8192 MB threshold
        _sendWarning: async (availableMb) => {
          warnings.push(availableMb);
        },
      });

      await monitor.checkNow();

      assert.equal(warnings.length, 0);
    });

    it('should NOT trigger warning when available space equals threshold', async () => {
      const warnings: number[] = [];
      const monitor = createDiskMonitor({
        dataDir: '/tmp/test',
        thresholdMb: 8192,
        _statfs: makeMockStatfs(8192), // exactly at threshold
        _sendWarning: async (availableMb) => {
          warnings.push(availableMb);
        },
      });

      await monitor.checkNow();

      assert.equal(warnings.length, 0);
    });

    it('should trigger warning when space is zero', async () => {
      const warnings: number[] = [];
      const monitor = createDiskMonitor({
        dataDir: '/tmp/test',
        thresholdMb: 8192,
        _statfs: makeMockStatfs(0),
        _sendWarning: async (availableMb) => {
          warnings.push(availableMb);
        },
      });

      await monitor.checkNow();

      assert.equal(warnings.length, 1);
      assert.equal(warnings[0], 0);
    });

    it('should respect custom threshold values', async () => {
      const warnings: number[] = [];
      const monitor = createDiskMonitor({
        dataDir: '/tmp/test',
        thresholdMb: 500, // lower threshold
        _statfs: makeMockStatfs(400), // below custom threshold
        _sendWarning: async (availableMb) => {
          warnings.push(availableMb);
        },
      });

      await monitor.checkNow();

      assert.equal(warnings.length, 1);
      assert.equal(warnings[0], 400);
    });
  });

  describe('polling interval', () => {
    it('should use 60-second polling interval when started', () => {
      let intervalMs: number | undefined;
      const originalSetInterval = globalThis.setInterval;
      globalThis.setInterval = ((fn: () => void, ms: number) => {
        intervalMs = ms;
        const id = originalSetInterval(fn, 999999); // don't actually poll
        timers.push(id);
        return id;
      }) as typeof globalThis.setInterval;

      try {
        const monitor = createDiskMonitor({
          dataDir: '/tmp/test',
          thresholdMb: 8192,
          _statfs: makeMockStatfs(10000),
          _sendWarning: async () => {},
        });

        monitor.start();

        assert.equal(intervalMs, 60_000, 'should poll every 60 seconds');

        monitor.stop();
      } finally {
        globalThis.setInterval = originalSetInterval;
      }
    });

    it('should stop polling when stop() is called', () => {
      let cleared = false;
      const originalSetInterval = globalThis.setInterval;
      const originalClearInterval = globalThis.clearInterval;
      let intervalId: ReturnType<typeof setTimeout> | undefined;

      globalThis.setInterval = ((fn: () => void, ms: number) => {
        const id = originalSetInterval(fn, 999999);
        intervalId = id;
        timers.push(id);
        return id;
      }) as typeof globalThis.setInterval;

      globalThis.clearInterval = ((id: ReturnType<typeof setTimeout>) => {
        if (id === intervalId) cleared = true;
        originalClearInterval(id);
      }) as typeof globalThis.clearInterval;

      try {
        const monitor = createDiskMonitor({
          dataDir: '/tmp/test',
          thresholdMb: 8192,
          _statfs: makeMockStatfs(10000),
          _sendWarning: async () => {},
        });

        monitor.start();
        monitor.stop();

        assert.ok(cleared, 'should clear the interval on stop');
      } finally {
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
      }
    });
  });

  describe('error handling', () => {
    it('should handle statfs errors gracefully without crashing', async () => {
      const monitor = createDiskMonitor({
        dataDir: '/tmp/nonexistent',
        thresholdMb: 8192,
        _statfs: makeMockStatfsError(),
        _sendWarning: async () => {},
      });

      // Should not throw
      await assert.doesNotReject(() => monitor.checkNow());
    });
  });

  describe('repeated warnings', () => {
    it('should not spam warnings on consecutive checks below threshold', async () => {
      const warnings: number[] = [];
      const monitor = createDiskMonitor({
        dataDir: '/tmp/test',
        thresholdMb: 8192,
        _statfs: makeMockStatfs(5000),
        _sendWarning: async (availableMb) => {
          warnings.push(availableMb);
        },
      });

      await monitor.checkNow();
      await monitor.checkNow();
      await monitor.checkNow();

      // Should only warn once until space recovers
      assert.equal(warnings.length, 1, 'should suppress repeated warnings');
    });

    it('should re-warn after space recovers and drops again', async () => {
      const warnings: number[] = [];
      let currentSpace = 5000;

      const monitor = createDiskMonitor({
        dataDir: '/tmp/test',
        thresholdMb: 8192,
        _statfs: (path, cb) => {
          const availBytes = BigInt(currentSpace) * 1024n * 1024n;
          cb(null, { bavail: availBytes / 4096n, bsize: 4096n });
        },
        _sendWarning: async (availableMb) => {
          warnings.push(availableMb);
        },
      });

      // First check: below threshold → warn
      await monitor.checkNow();
      assert.equal(warnings.length, 1);

      // Space recovers above threshold
      currentSpace = 10000;
      await monitor.checkNow();

      // Space drops again
      currentSpace = 3000;
      await monitor.checkNow();
      assert.equal(warnings.length, 2, 'should warn again after recovery');
    });
  });
});
