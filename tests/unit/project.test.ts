import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  listProjects,
  getProject,
  createProject,
  removeProject,
} from '../../src/models/project.ts';

describe('project model', () => {
  let tmpDir: string;
  let dataDir: string;
  let projectsJsonPath: string;
  let validProjectDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'project-model-test-'));
    dataDir = join(tmpDir, 'data');
    mkdirSync(dataDir, { recursive: true });
    projectsJsonPath = join(dataDir, 'projects.json');
    writeFileSync(projectsJsonPath, '[]\n');

    // Create a valid project directory with a tasks.md
    validProjectDir = join(tmpDir, 'my-project');
    mkdirSync(validProjectDir, { recursive: true });
    writeFileSync(
      join(validProjectDir, 'tasks.md'),
      '# Tasks\n\n## Phase 1: Setup\n\n- [ ] 1.1 Do something\n',
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('listProjects', () => {
    it('should return empty array when no projects registered', () => {
      const projects = listProjects(dataDir);
      assert.ok(Array.isArray(projects));
      assert.equal(projects.length, 0);
    });

    it('should return all registered projects', () => {
      createProject(dataDir, { name: 'proj-1', dir: validProjectDir });

      const secondDir = join(tmpDir, 'second-project');
      mkdirSync(secondDir, { recursive: true });
      writeFileSync(join(secondDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 A task\n');
      createProject(dataDir, { name: 'proj-2', dir: secondDir });

      const projects = listProjects(dataDir);
      assert.equal(projects.length, 2);
    });
  });

  describe('getProject', () => {
    it('should return a project by id', () => {
      const created = createProject(dataDir, { name: 'my-proj', dir: validProjectDir });
      const found = getProject(dataDir, created.id);
      assert.ok(found);
      assert.equal(found!.id, created.id);
      assert.equal(found!.name, 'my-proj');
      assert.equal(found!.dir, validProjectDir);
    });

    it('should return null for unknown id', () => {
      const found = getProject(dataDir, 'nonexistent-id');
      assert.equal(found, null);
    });
  });

  describe('createProject', () => {
    it('should create a project with generated id and createdAt', () => {
      const project = createProject(dataDir, { name: 'test', dir: validProjectDir });
      assert.ok(project.id, 'Should have a generated id');
      assert.equal(project.name, 'test');
      assert.equal(project.dir, validProjectDir);
      assert.ok(project.createdAt, 'Should have a createdAt timestamp');
    });

    it('should default taskFile to tasks.md', () => {
      const project = createProject(dataDir, { name: 'test', dir: validProjectDir });
      assert.equal(project.taskFile, 'tasks.md');
    });

    it('should persist the project to projects.json', () => {
      const project = createProject(dataDir, { name: 'persisted', dir: validProjectDir });
      const raw = readFileSync(projectsJsonPath, 'utf-8');
      const stored = JSON.parse(raw);
      assert.equal(stored.length, 1);
      assert.equal(stored[0].id, project.id);
    });

    it('should reject empty name', () => {
      assert.throws(
        () => createProject(dataDir, { name: '', dir: validProjectDir }),
        /name/i,
      );
    });

    it('should reject name exceeding 100 characters', () => {
      const longName = 'a'.repeat(101);
      assert.throws(
        () => createProject(dataDir, { name: longName, dir: validProjectDir }),
        /name/i,
      );
    });

    it('should reject non-existent directory', () => {
      assert.throws(
        () => createProject(dataDir, { name: 'ghost', dir: '/tmp/nonexistent-dir-99999' }),
        /dir/i,
      );
    });

    it('should reject directory without tasks.md', () => {
      const emptyDir = join(tmpDir, 'empty-dir');
      mkdirSync(emptyDir, { recursive: true });
      assert.throws(
        () => createProject(dataDir, { name: 'empty', dir: emptyDir }),
        /tasks\.md/i,
      );
    });

    it('should reject duplicate directory registration', () => {
      createProject(dataDir, { name: 'first', dir: validProjectDir });
      assert.throws(
        () => createProject(dataDir, { name: 'second', dir: validProjectDir }),
        /already registered/i,
      );
    });

    it('should generate unique ids for different projects', () => {
      const p1 = createProject(dataDir, { name: 'proj-1', dir: validProjectDir });

      const secondDir = join(tmpDir, 'proj-2');
      mkdirSync(secondDir, { recursive: true });
      writeFileSync(join(secondDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Task\n');
      const p2 = createProject(dataDir, { name: 'proj-2', dir: secondDir });

      assert.notEqual(p1.id, p2.id);
    });
  });

  describe('removeProject', () => {
    it('should remove a project by id', () => {
      const project = createProject(dataDir, { name: 'to-remove', dir: validProjectDir });
      removeProject(dataDir, project.id);

      const found = getProject(dataDir, project.id);
      assert.equal(found, null);
    });

    it('should persist removal to projects.json', () => {
      const project = createProject(dataDir, { name: 'to-remove', dir: validProjectDir });
      removeProject(dataDir, project.id);

      const raw = readFileSync(projectsJsonPath, 'utf-8');
      const stored = JSON.parse(raw);
      assert.equal(stored.length, 0);
    });

    it('should throw for unknown project id', () => {
      assert.throws(
        () => removeProject(dataDir, 'nonexistent-id'),
        /not found/i,
      );
    });

    it('should not affect other projects when removing one', () => {
      const p1 = createProject(dataDir, { name: 'keep', dir: validProjectDir });

      const secondDir = join(tmpDir, 'second');
      mkdirSync(secondDir, { recursive: true });
      writeFileSync(join(secondDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 Task\n');
      const p2 = createProject(dataDir, { name: 'remove', dir: secondDir });

      removeProject(dataDir, p2.id);

      const projects = listProjects(dataDir);
      assert.equal(projects.length, 1);
      assert.equal(projects[0].id, p1.id);
    });
  });
});
