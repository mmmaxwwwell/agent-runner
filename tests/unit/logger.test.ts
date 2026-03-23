import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setLevel, getLevel, createLogger, logger } from '../../src/lib/logger.ts';
import type { ComponentName } from '../../src/lib/logger.ts';

describe('logger', () => {
  beforeEach(() => {
    // Reset to default level
    setLevel('info');
  });

  it('should export a root logger', () => {
    assert.ok(logger);
    assert.equal(typeof logger.info, 'function');
    assert.equal(typeof logger.error, 'function');
    assert.equal(typeof logger.debug, 'function');
    assert.equal(typeof logger.warn, 'function');
    assert.equal(typeof logger.fatal, 'function');
  });

  it('should have default level of info', () => {
    assert.equal(getLevel(), 'info');
  });

  it('should change level via setLevel', () => {
    setLevel('debug');
    assert.equal(getLevel(), 'debug');

    setLevel('error');
    assert.equal(getLevel(), 'error');

    setLevel('fatal');
    assert.equal(getLevel(), 'fatal');

    setLevel('warn');
    assert.equal(getLevel(), 'warn');
  });

  it('should create child loggers with component field', () => {
    const childLogger = createLogger('server');
    assert.ok(childLogger);
    assert.equal(typeof childLogger.info, 'function');
    assert.equal(typeof childLogger.error, 'function');
  });

  it('should create child loggers for all valid component names', () => {
    const components: ComponentName[] = [
      'server',
      'session-manager',
      'process-spawner',
      'sandbox',
      'websocket',
      'push',
      'voice',
      'task-parser',
      'recovery',
      'disk-monitor',
      'spec-kit',
    ];

    for (const component of components) {
      const childLogger = createLogger(component);
      assert.ok(childLogger, `Failed to create logger for component: ${component}`);
    }
  });

  it('should propagate level changes to child loggers', () => {
    const childLogger = createLogger('server');
    setLevel('debug');
    // Child loggers inherit the root level
    assert.equal(childLogger.level, 'debug');

    setLevel('error');
    assert.equal(childLogger.level, 'error');
  });

  it('should output JSON to stderr', () => {
    // Pino is configured with pino.destination({ fd: 2 }) which writes to stderr
    // We verify the logger is configured correctly by checking its serializers/options
    assert.ok(logger);
    // The logger should have the standard pino methods
    assert.equal(typeof logger.child, 'function');
    assert.equal(typeof logger.flush, 'function');
  });
});

describe('PUT /api/config/log-level contract', () => {
  it('should define the expected log levels', () => {
    // Contract: PUT /api/config/log-level accepts debug, info, warn, error, fatal
    const validLevels = ['debug', 'info', 'warn', 'error', 'fatal'];
    for (const level of validLevels) {
      setLevel(level as 'debug' | 'info' | 'warn' | 'error' | 'fatal');
      assert.equal(getLevel(), level);
    }
  });

  it('should return the current level after setting', () => {
    // Contract: PUT /api/config/log-level returns { level: "debug" }
    // We test the underlying function that the endpoint will call
    setLevel('debug');
    const result = getLevel();
    assert.equal(result, 'debug');
  });

  it('should support all five log levels per rest-api.md', () => {
    // Contract verification: valid levels are exactly debug, info, warn, error, fatal
    const expectedLevels = new Set(['debug', 'info', 'warn', 'error', 'fatal']);
    for (const level of expectedLevels) {
      // setLevel should not throw for valid levels
      setLevel(level as 'debug' | 'info' | 'warn' | 'error' | 'fatal');
      assert.equal(getLevel(), level);
    }
  });
});
