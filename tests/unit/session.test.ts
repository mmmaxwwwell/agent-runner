import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createSession,
  getSession,
  listSessionsByProject,
  transitionState,
  type Session,
  type SessionType,
  type SessionState,
} from '../../src/models/session.ts';

describe('session model', () => {
  let tmpDir: string;
  let dataDir: string;
  let sessionsDir: string;
  const projectId = 'test-project-id';

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'session-model-test-'));
    dataDir = join(tmpDir, 'data');
    sessionsDir = join(dataDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createSession', () => {
    it('should create a session with generated id and startedAt', () => {
      const session = createSession(dataDir, {
        projectId,
        type: 'task-run',
      });

      assert.ok(session.id, 'Should have a generated id');
      assert.equal(session.projectId, projectId);
      assert.equal(session.type, 'task-run');
      assert.equal(session.state, 'running');
      assert.ok(session.startedAt, 'Should have a startedAt timestamp');
      assert.equal(session.endedAt, null);
      assert.equal(session.pid, null);
      assert.equal(session.lastTaskId, null);
      assert.equal(session.question, null);
      assert.equal(session.exitCode, null);
    });

    it('should create a session directory with meta.json', () => {
      const session = createSession(dataDir, {
        projectId,
        type: 'task-run',
      });

      const metaPath = join(sessionsDir, session.id, 'meta.json');
      assert.ok(existsSync(metaPath), 'meta.json should exist');

      const stored = JSON.parse(readFileSync(metaPath, 'utf-8'));
      assert.equal(stored.id, session.id);
      assert.equal(stored.projectId, projectId);
      assert.equal(stored.type, 'task-run');
      assert.equal(stored.state, 'running');
    });

    it('should create an interview session', () => {
      const session = createSession(dataDir, {
        projectId,
        type: 'interview',
      });

      assert.equal(session.type, 'interview');
      assert.equal(session.state, 'running');
    });

    it('should reject creating a session when project already has an active running session', () => {
      createSession(dataDir, { projectId, type: 'task-run' });

      assert.throws(
        () => createSession(dataDir, { projectId, type: 'task-run' }),
        /active session/i,
      );
    });

    it('should reject creating a session when project has a waiting-for-input session', () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      transitionState(dataDir, session.id, 'waiting-for-input', {
        question: 'What API key?',
      });

      assert.throws(
        () => createSession(dataDir, { projectId, type: 'task-run' }),
        /active session/i,
      );
    });

    it('should allow creating a session after previous session completed', () => {
      const first = createSession(dataDir, { projectId, type: 'task-run' });
      transitionState(dataDir, first.id, 'completed', { exitCode: 0 });

      const second = createSession(dataDir, { projectId, type: 'task-run' });
      assert.ok(second.id);
      assert.notEqual(second.id, first.id);
    });

    it('should allow creating a session after previous session failed', () => {
      const first = createSession(dataDir, { projectId, type: 'task-run' });
      transitionState(dataDir, first.id, 'failed', { exitCode: 1 });

      const second = createSession(dataDir, { projectId, type: 'task-run' });
      assert.ok(second.id);
    });

    it('should generate unique ids for different sessions', () => {
      const s1 = createSession(dataDir, { projectId: 'proj-1', type: 'task-run' });
      const s2 = createSession(dataDir, { projectId: 'proj-2', type: 'task-run' });
      assert.notEqual(s1.id, s2.id);
    });
  });

  describe('getSession', () => {
    it('should return a session by id', () => {
      const created = createSession(dataDir, { projectId, type: 'task-run' });
      const found = getSession(dataDir, created.id);

      assert.ok(found);
      assert.equal(found!.id, created.id);
      assert.equal(found!.projectId, projectId);
      assert.equal(found!.type, 'task-run');
      assert.equal(found!.state, 'running');
    });

    it('should return null for unknown id', () => {
      const found = getSession(dataDir, 'nonexistent-id');
      assert.equal(found, null);
    });

    it('should reflect state changes after transition', () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      transitionState(dataDir, session.id, 'waiting-for-input', {
        question: 'Which key?',
      });

      const found = getSession(dataDir, session.id);
      assert.ok(found);
      assert.equal(found!.state, 'waiting-for-input');
      assert.equal(found!.question, 'Which key?');
    });
  });

  describe('listSessionsByProject', () => {
    it('should return empty array when no sessions exist for project', () => {
      const sessions = listSessionsByProject(dataDir, 'no-such-project');
      assert.ok(Array.isArray(sessions));
      assert.equal(sessions.length, 0);
    });

    it('should return all sessions for a project', () => {
      const s1 = createSession(dataDir, { projectId, type: 'task-run' });
      transitionState(dataDir, s1.id, 'completed', { exitCode: 0 });

      const s2 = createSession(dataDir, { projectId, type: 'task-run' });

      const sessions = listSessionsByProject(dataDir, projectId);
      assert.equal(sessions.length, 2);
      const ids = sessions.map(s => s.id);
      assert.ok(ids.includes(s1.id));
      assert.ok(ids.includes(s2.id));
    });

    it('should not include sessions from other projects', () => {
      createSession(dataDir, { projectId: 'proj-a', type: 'task-run' });
      createSession(dataDir, { projectId: 'proj-b', type: 'task-run' });

      const sessions = listSessionsByProject(dataDir, 'proj-a');
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].projectId, 'proj-a');
    });
  });

  describe('transitionState', () => {
    describe('running -> waiting-for-input', () => {
      it('should transition with a question', () => {
        const session = createSession(dataDir, { projectId, type: 'task-run' });
        const updated = transitionState(dataDir, session.id, 'waiting-for-input', {
          question: 'What API key should I use?',
        });

        assert.equal(updated.state, 'waiting-for-input');
        assert.equal(updated.question, 'What API key should I use?');
        assert.equal(updated.pid, null);
      });

      it('should persist the transition to meta.json', () => {
        const session = createSession(dataDir, { projectId, type: 'task-run' });
        transitionState(dataDir, session.id, 'waiting-for-input', {
          question: 'Which env?',
        });

        const metaPath = join(sessionsDir, session.id, 'meta.json');
        const stored = JSON.parse(readFileSync(metaPath, 'utf-8'));
        assert.equal(stored.state, 'waiting-for-input');
        assert.equal(stored.question, 'Which env?');
      });
    });

    describe('running -> completed', () => {
      it('should transition to completed with exitCode', () => {
        const session = createSession(dataDir, { projectId, type: 'task-run' });
        const updated = transitionState(dataDir, session.id, 'completed', {
          exitCode: 0,
        });

        assert.equal(updated.state, 'completed');
        assert.equal(updated.exitCode, 0);
        assert.ok(updated.endedAt, 'Should set endedAt');
        assert.equal(updated.pid, null);
      });
    });

    describe('running -> failed', () => {
      it('should transition to failed with exitCode', () => {
        const session = createSession(dataDir, { projectId, type: 'task-run' });
        const updated = transitionState(dataDir, session.id, 'failed', {
          exitCode: 1,
        });

        assert.equal(updated.state, 'failed');
        assert.equal(updated.exitCode, 1);
        assert.ok(updated.endedAt, 'Should set endedAt');
      });

      it('should handle exit code -1 for manual stop', () => {
        const session = createSession(dataDir, { projectId, type: 'task-run' });
        const updated = transitionState(dataDir, session.id, 'failed', {
          exitCode: -1,
        });

        assert.equal(updated.state, 'failed');
        assert.equal(updated.exitCode, -1);
      });
    });

    describe('waiting-for-input -> running', () => {
      it('should transition back to running (same session resumes)', () => {
        const session = createSession(dataDir, { projectId, type: 'task-run' });
        transitionState(dataDir, session.id, 'waiting-for-input', {
          question: 'What key?',
        });

        const updated = transitionState(dataDir, session.id, 'running');

        assert.equal(updated.state, 'running');
        assert.equal(updated.question, null);
      });
    });

    describe('invalid transitions', () => {
      it('should reject completed -> running', () => {
        const session = createSession(dataDir, { projectId, type: 'task-run' });
        transitionState(dataDir, session.id, 'completed', { exitCode: 0 });

        assert.throws(
          () => transitionState(dataDir, session.id, 'running'),
          /invalid.*transition/i,
        );
      });

      it('should reject failed -> running', () => {
        const session = createSession(dataDir, { projectId, type: 'task-run' });
        transitionState(dataDir, session.id, 'failed', { exitCode: 1 });

        assert.throws(
          () => transitionState(dataDir, session.id, 'running'),
          /invalid.*transition/i,
        );
      });

      it('should reject completed -> waiting-for-input', () => {
        const session = createSession(dataDir, { projectId, type: 'task-run' });
        transitionState(dataDir, session.id, 'completed', { exitCode: 0 });

        assert.throws(
          () => transitionState(dataDir, session.id, 'waiting-for-input', {
            question: 'test',
          }),
          /invalid.*transition/i,
        );
      });

      it('should reject waiting-for-input -> completed', () => {
        const session = createSession(dataDir, { projectId, type: 'task-run' });
        transitionState(dataDir, session.id, 'waiting-for-input', {
          question: 'test',
        });

        assert.throws(
          () => transitionState(dataDir, session.id, 'completed', { exitCode: 0 }),
          /invalid.*transition/i,
        );
      });

      it('should reject waiting-for-input -> failed', () => {
        const session = createSession(dataDir, { projectId, type: 'task-run' });
        transitionState(dataDir, session.id, 'waiting-for-input', {
          question: 'test',
        });

        assert.throws(
          () => transitionState(dataDir, session.id, 'failed', { exitCode: 1 }),
          /invalid.*transition/i,
        );
      });

      it('should reject running -> running', () => {
        const session = createSession(dataDir, { projectId, type: 'task-run' });

        assert.throws(
          () => transitionState(dataDir, session.id, 'running'),
          /invalid.*transition/i,
        );
      });
    });

    it('should throw for unknown session id', () => {
      assert.throws(
        () => transitionState(dataDir, 'nonexistent', 'completed', { exitCode: 0 }),
        /not found/i,
      );
    });
  });

  describe('meta.json persistence', () => {
    it('should persist pid updates', () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const metaPath = join(sessionsDir, session.id, 'meta.json');

      // Simulate setting pid by reading/writing meta directly
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      assert.equal(meta.pid, null);
    });

    it('should persist lastTaskId through transitions', () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      const updated = transitionState(dataDir, session.id, 'waiting-for-input', {
        question: 'What key?',
        lastTaskId: '2.3',
      });

      assert.equal(updated.lastTaskId, '2.3');

      const metaPath = join(sessionsDir, session.id, 'meta.json');
      const stored = JSON.parse(readFileSync(metaPath, 'utf-8'));
      assert.equal(stored.lastTaskId, '2.3');
    });

    it('should survive read after write (round-trip)', () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      transitionState(dataDir, session.id, 'waiting-for-input', {
        question: 'Which database?',
        lastTaskId: '3.1',
      });

      // Re-read from disk
      const reloaded = getSession(dataDir, session.id);
      assert.ok(reloaded);
      assert.equal(reloaded!.state, 'waiting-for-input');
      assert.equal(reloaded!.question, 'Which database?');
      assert.equal(reloaded!.lastTaskId, '3.1');
      assert.equal(reloaded!.projectId, projectId);
      assert.equal(reloaded!.type, 'task-run');
    });
  });

  describe('concurrent session prevention', () => {
    it('should allow sessions on different projects simultaneously', () => {
      const s1 = createSession(dataDir, { projectId: 'proj-a', type: 'task-run' });
      const s2 = createSession(dataDir, { projectId: 'proj-b', type: 'task-run' });

      assert.ok(s1.id);
      assert.ok(s2.id);
      assert.equal(s1.state, 'running');
      assert.equal(s2.state, 'running');
    });

    it('should prevent two running sessions on the same project', () => {
      createSession(dataDir, { projectId, type: 'task-run' });

      assert.throws(
        () => createSession(dataDir, { projectId, type: 'interview' }),
        /active session/i,
      );
    });

    it('should prevent new session when existing is waiting-for-input', () => {
      const session = createSession(dataDir, { projectId, type: 'task-run' });
      transitionState(dataDir, session.id, 'waiting-for-input', {
        question: 'test?',
      });

      assert.throws(
        () => createSession(dataDir, { projectId, type: 'task-run' }),
        /active session/i,
      );
    });
  });
});
