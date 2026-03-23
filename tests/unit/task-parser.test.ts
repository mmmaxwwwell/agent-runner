import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseTasks, parseTaskSummary } from '../../src/services/task-parser.ts';

// Sample task file content mimicking agent-framework format
const SAMPLE_TASK_FILE = `# Tasks: My Project

## Phase 1: Setup

- [x] 1.1 Initialize project
- [x] 1.2 Configure TypeScript
- [~] 1.3 Optional setup step — Skipped: not needed

## Phase 2: Core Implementation

- [x] 2.1 Write unit tests
- [ ] 2.2 Implement feature A
- [?] 2.3 Implement feature B — Blocked: What API key should I use?
- [ ] 2.4 Implement feature C

## Phase 3: Polish

- [ ] 3.1 Add error handling
  - [ ] 3.1.1 Handle network errors
  - [ ] 3.1.2 Handle file errors
- [ ] 3.2 Final review
`;

describe('task-parser', () => {
  let tmpDir: string;

  function writeTaskFile(content: string): string {
    const filePath = join(tmpDir, 'tasks.md');
    writeFileSync(filePath, content);
    return filePath;
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'task-parser-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('parseTasks', () => {
    it('should parse all four checkbox status markers', () => {
      const filePath = writeTaskFile(SAMPLE_TASK_FILE);
      const tasks = parseTasks(filePath);

      const task11 = tasks.find(t => t.id === '1.1');
      assert.equal(task11?.status, 'checked');

      const task13 = tasks.find(t => t.id === '1.3');
      assert.equal(task13?.status, 'skipped');

      const task22 = tasks.find(t => t.id === '2.2');
      assert.equal(task22?.status, 'unchecked');

      const task23 = tasks.find(t => t.id === '2.3');
      assert.equal(task23?.status, 'blocked');
    });

    it('should extract phase number and name from headers', () => {
      const filePath = writeTaskFile(SAMPLE_TASK_FILE);
      const tasks = parseTasks(filePath);

      const task11 = tasks.find(t => t.id === '1.1');
      assert.equal(task11?.phase, 1);
      assert.equal(task11?.phaseName, 'Setup');

      const task22 = tasks.find(t => t.id === '2.2');
      assert.equal(task22?.phase, 2);
      assert.equal(task22?.phaseName, 'Core Implementation');

      const task31 = tasks.find(t => t.id === '3.1');
      assert.equal(task31?.phase, 3);
      assert.equal(task31?.phaseName, 'Polish');
    });

    it('should extract task descriptions', () => {
      const filePath = writeTaskFile(SAMPLE_TASK_FILE);
      const tasks = parseTasks(filePath);

      const task11 = tasks.find(t => t.id === '1.1');
      assert.equal(task11?.description, 'Initialize project');

      const task22 = tasks.find(t => t.id === '2.2');
      assert.equal(task22?.description, 'Implement feature A');
    });

    it('should extract blocked reason from [?] tasks', () => {
      const filePath = writeTaskFile(SAMPLE_TASK_FILE);
      const tasks = parseTasks(filePath);

      const task23 = tasks.find(t => t.id === '2.3');
      assert.equal(task23?.status, 'blocked');
      assert.equal(task23?.blockedReason, 'What API key should I use?');
    });

    it('should set blockedReason to null for non-blocked tasks', () => {
      const filePath = writeTaskFile(SAMPLE_TASK_FILE);
      const tasks = parseTasks(filePath);

      const task11 = tasks.find(t => t.id === '1.1');
      assert.equal(task11?.blockedReason, null);

      const task22 = tasks.find(t => t.id === '2.2');
      assert.equal(task22?.blockedReason, null);
    });

    it('should detect nesting depth from indentation', () => {
      const filePath = writeTaskFile(SAMPLE_TASK_FILE);
      const tasks = parseTasks(filePath);

      const task31 = tasks.find(t => t.id === '3.1');
      assert.equal(task31?.depth, 0);

      const task311 = tasks.find(t => t.id === '3.1.1');
      assert.equal(task311?.depth, 1);

      const task312 = tasks.find(t => t.id === '3.1.2');
      assert.equal(task312?.depth, 1);
    });

    it('should parse all tasks in the file', () => {
      const filePath = writeTaskFile(SAMPLE_TASK_FILE);
      const tasks = parseTasks(filePath);

      // 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 3.1, 3.1.1, 3.1.2, 3.2
      assert.equal(tasks.length, 11);
    });

    it('should handle skipped tasks with suffix', () => {
      const filePath = writeTaskFile(SAMPLE_TASK_FILE);
      const tasks = parseTasks(filePath);

      const task13 = tasks.find(t => t.id === '1.3');
      assert.equal(task13?.status, 'skipped');
      assert.ok(task13?.description.includes('Optional setup step'));
    });

    it('should handle empty task file', () => {
      const filePath = writeTaskFile('# Tasks\n\nNo tasks here.\n');
      const tasks = parseTasks(filePath);
      assert.equal(tasks.length, 0);
    });

    it('should handle task file with only headers', () => {
      const filePath = writeTaskFile('# Tasks\n\n## Phase 1: Setup\n\n## Phase 2: Build\n');
      const tasks = parseTasks(filePath);
      assert.equal(tasks.length, 0);
    });

    it('should throw on missing file', () => {
      const fakePath = join(tmpDir, 'nonexistent.md');
      assert.throws(() => parseTasks(fakePath));
    });

    it('should handle tasks without phase headers', () => {
      const content = `# Tasks

- [ ] 1.1 Do something
- [x] 1.2 Do another thing
`;
      const filePath = writeTaskFile(content);
      const tasks = parseTasks(filePath);

      assert.equal(tasks.length, 2);
      // Without a phase header, phase should be 0 or undefined
      assert.equal(tasks[0].id, '1.1');
      assert.equal(tasks[1].id, '1.2');
    });

    it('should handle Done suffix on checked tasks', () => {
      const content = `## Phase 1: Setup

- [x] 1.1 Initialize project — Done: completed successfully
`;
      const filePath = writeTaskFile(content);
      const tasks = parseTasks(filePath);

      assert.equal(tasks[0].status, 'checked');
      assert.ok(tasks[0].description.includes('Initialize project'));
    });
  });

  describe('parseTaskSummary', () => {
    it('should compute correct summary counts', () => {
      const filePath = writeTaskFile(SAMPLE_TASK_FILE);
      const summary = parseTaskSummary(filePath);

      assert.equal(summary.total, 11);
      assert.equal(summary.completed, 3); // 1.1, 1.2, 2.1
      assert.equal(summary.blocked, 1);   // 2.3
      assert.equal(summary.skipped, 1);   // 1.3
      assert.equal(summary.remaining, 6); // 2.2, 2.4, 3.1, 3.1.1, 3.1.2, 3.2
    });

    it('should return all zeros for empty task file', () => {
      const filePath = writeTaskFile('# Tasks\n');
      const summary = parseTaskSummary(filePath);

      assert.equal(summary.total, 0);
      assert.equal(summary.completed, 0);
      assert.equal(summary.blocked, 0);
      assert.equal(summary.skipped, 0);
      assert.equal(summary.remaining, 0);
    });

    it('should report all tasks completed when all checked or skipped', () => {
      const content = `## Phase 1: Setup

- [x] 1.1 Task A
- [x] 1.2 Task B
- [~] 1.3 Task C — Skipped: not needed
`;
      const filePath = writeTaskFile(content);
      const summary = parseTaskSummary(filePath);

      assert.equal(summary.total, 3);
      assert.equal(summary.completed, 2);
      assert.equal(summary.skipped, 1);
      assert.equal(summary.remaining, 0);
      assert.equal(summary.blocked, 0);
    });
  });
});
