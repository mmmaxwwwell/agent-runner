/**
 * Custom Node.js test runner reporter that writes structured output to
 * test-logs/<type>/<timestamp>/summary.json and failures/<test-name>.log
 *
 * Usage: --test-reporter=./tests/helpers/test-reporter.ts
 * Set TEST_TYPE env var to 'unit', 'integration', or 'contract'.
 *
 * Per FR-111–FR-114:
 * - Passing tests: summary line only (name + duration)
 * - Failing tests: assertion details, expected/actual, stack trace, context
 * - summary.json: pass/fail counts + list of failed test names
 * - failures/: one .log file per failing test
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface TestEvent {
  type: string;
  data: {
    name: string;
    nesting: number;
    testNumber: number;
    file?: string;
    line?: number;
    column?: number;
    todo?: boolean | string;
    skip?: boolean | string;
    details?: {
      duration_ms: number;
      type?: string;
      error?: {
        message?: string;
        cause?: unknown;
        failureType?: string;
        code?: string;
        expected?: unknown;
        actual?: unknown;
        operator?: string;
        stack?: string;
      };
    };
  };
}

interface PassedTest {
  name: string;
  file?: string;
  duration_ms: number;
}

interface FailedTest {
  name: string;
  file?: string;
  duration_ms: number;
  error: {
    message?: string;
    expected?: unknown;
    actual?: unknown;
    operator?: string;
    stack?: string;
    failureType?: string;
  };
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 200);
}

export default async function* reporter(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  const testType = process.env['TEST_TYPE'] || 'unknown';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(process.cwd(), 'test-logs', testType, timestamp);
  const failuresDir = join(outDir, 'failures');

  const passed: PassedTest[] = [];
  const failed: FailedTest[] = [];
  const skipped: string[] = [];

  for await (const event of source) {
    if (event.type === 'test:pass') {
      const { name, nesting, details, file, skip } = event.data;
      if (skip) {
        skipped.push(name);
        yield `  ⊘ ${name} (skipped)\n`;
        continue;
      }
      const duration = details?.duration_ms ?? 0;
      const isSuite = details?.type === 'suite';
      if (nesting === 0) {
        // Top-level suite pass — just show the file
        yield `✓ ${file ?? name} (${duration.toFixed(1)}ms)\n`;
      } else if (isSuite) {
        // Sub-suite (describe block) — show but don't count
        yield `  ✓ ${name} (${duration.toFixed(1)}ms)\n`;
      } else {
        // Leaf test — count it
        passed.push({ name, file, duration_ms: duration });
        yield `  ✓ ${name} (${duration.toFixed(1)}ms)\n`;
      }
    } else if (event.type === 'test:fail') {
      const { name, nesting, details, file, skip, todo } = event.data;
      if (skip || todo) {
        skipped.push(name);
        yield `  ⊘ ${name} (skipped/todo)\n`;
        continue;
      }
      const duration = details?.duration_ms ?? 0;
      const error = details?.error ?? {};
      const isSuite = details?.type === 'suite';
      if (nesting === 0) {
        // Top-level suite fail — report it
        yield `✗ ${file ?? name} (${duration.toFixed(1)}ms)\n`;
        // If top-level fail has an error (e.g., uncaught), still record it
        if (error.message && !failed.some(f => f.file === file)) {
          failed.push({
            name,
            file,
            duration_ms: duration,
            error: {
              message: error.message,
              expected: error.expected,
              actual: error.actual,
              operator: error.operator,
              stack: error.stack,
              failureType: error.failureType,
            },
          });
        }
      } else if (isSuite) {
        // Sub-suite (describe block) fail — show but don't double-count
        yield `  ✗ ${name} (${duration.toFixed(1)}ms)\n`;
      } else {
        // Leaf test failure — count and record
        failed.push({
          name,
          file,
          duration_ms: duration,
          error: {
            message: error.message,
            expected: error.expected,
            actual: error.actual,
            operator: error.operator,
            stack: error.stack,
            failureType: error.failureType,
          },
        });
        yield `  ✗ ${name} (${duration.toFixed(1)}ms)\n`;
        if (error.message) {
          yield `    ${error.message}\n`;
        }
      }
    } else if (event.type === 'test:diagnostic') {
      // Show diagnostics (e.g., "tests 10", "pass 8", "fail 2")
      yield `# ${event.data.message ?? event.data}\n`;
    } else if (event.type === 'test:start') {
      const { name, nesting, file } = event.data;
      if (nesting === 0 && file) {
        yield `\n▶ ${file}\n`;
      } else if (nesting === 1) {
        yield `  ▶ ${name}\n`;
      }
    }
  }

  // Write structured output
  mkdirSync(failuresDir, { recursive: true });

  // Write summary.json
  const summary = {
    type: testType,
    timestamp,
    total: passed.length + failed.length + skipped.length,
    passed: passed.length,
    failed: failed.length,
    skipped: skipped.length,
    duration_ms: [...passed, ...failed].reduce((sum, t) => sum + t.duration_ms, 0),
    failedTests: failed.map(f => f.name),
  };
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

  // Write failure detail files
  for (const f of failed) {
    const filename = sanitizeFilename(f.name) + '.log';
    const lines = [
      `Test: ${f.name}`,
      `File: ${f.file ?? 'unknown'}`,
      `Duration: ${f.duration_ms.toFixed(1)}ms`,
      `Failure Type: ${f.error.failureType ?? 'unknown'}`,
      '',
      '--- Assertion Details ---',
      `Message: ${f.error.message ?? 'none'}`,
      `Operator: ${f.error.operator ?? 'none'}`,
      `Expected: ${formatValue(f.error.expected)}`,
      `Actual: ${formatValue(f.error.actual)}`,
      '',
      '--- Stack Trace ---',
      f.error.stack ?? 'no stack trace',
      '',
    ];
    writeFileSync(join(failuresDir, filename), lines.join('\n'));
  }

  // Final summary line
  yield `\n─── Summary ───\n`;
  yield `Total: ${summary.total} | Passed: ${summary.passed} | Failed: ${summary.failed} | Skipped: ${summary.skipped}\n`;
  yield `Duration: ${(summary.duration_ms / 1000).toFixed(2)}s\n`;
  yield `Results: ${outDir}\n`;

  if (failed.length > 0) {
    yield `\nFailed tests:\n`;
    for (const f of failed) {
      yield `  - ${f.name}\n`;
    }
  }
}

function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
