import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export type ProjectStatus = "active" | "onboarding" | "error";

export interface Project {
  id: string;
  name: string;
  dir: string;
  taskFile: string;
  promptFile: string;
  createdAt: string;
  status: ProjectStatus;
}

export interface CreateProjectInput {
  name: string;
  dir: string;
}

export interface DiscoveredDirectory {
  type: "discovered";
  name: string;           // Directory basename
  path: string;           // Absolute path
  isGitRepo: boolean;
  hasSpecKit: {
    spec: boolean;
    plan: boolean;
    tasks: boolean;
  };
}

function projectsJsonPath(dataDir: string): string {
  return join(dataDir, 'projects.json');
}

function readProjects(dataDir: string): Project[] {
  const path = projectsJsonPath(dataDir);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf-8');
  const projects = JSON.parse(raw) as Array<Omit<Project, 'status'> & { status?: ProjectStatus }>;
  return projects.map(p => ({ ...p, status: p.status ?? 'active' }));
}

function writeProjects(dataDir: string, projects: Project[]): void {
  writeFileSync(projectsJsonPath(dataDir), JSON.stringify(projects, null, 2) + '\n', 'utf-8');
}

function detectPromptFile(dir: string): string {
  // Scan for spec-kit artifacts: look for a prompt.md or *-prompt.md file
  try {
    const files = readdirSync(dir);
    // Prefer exact 'prompt.md'
    if (files.includes('prompt.md')) return 'prompt.md';
    // Look for *-prompt.md pattern
    const promptFile = files.find(f => f.endsWith('-prompt.md'));
    if (promptFile) return promptFile;
  } catch {
    // Directory read failed, fall through
  }
  return '';
}

export function listProjects(dataDir: string): Project[] {
  return readProjects(dataDir);
}

export function getProject(dataDir: string, id: string): Project | null {
  const projects = readProjects(dataDir);
  return projects.find(p => p.id === id) ?? null;
}

export function createProject(dataDir: string, input: CreateProjectInput): Project {
  const { name, dir } = input;

  // Validate name
  if (!name || name.trim().length === 0) {
    throw new Error('Project name must be non-empty');
  }
  if (name.length > 100) {
    throw new Error('Project name must be 100 characters or fewer');
  }

  // Validate dir exists and is a directory
  const absDir = resolve(dir);
  if (!existsSync(absDir)) {
    throw new Error(`Directory does not exist: ${dir}`);
  }
  const stat = statSync(absDir);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${dir}`);
  }

  // Validate tasks.md exists
  if (!existsSync(join(absDir, 'tasks.md'))) {
    throw new Error(`No tasks.md file found in directory: ${dir}`);
  }

  // Check for duplicate directory
  const projects = readProjects(dataDir);
  if (projects.some(p => resolve(p.dir) === absDir)) {
    throw new Error(`A project with this directory is already registered: ${dir}`);
  }

  const project: Project = {
    id: randomUUID(),
    name: name.trim(),
    dir: absDir,
    taskFile: 'tasks.md',
    promptFile: detectPromptFile(absDir),
    createdAt: new Date().toISOString(),
    status: 'active',
  };

  projects.push(project);
  writeProjects(dataDir, projects);

  return project;
}

export function registerForOnboarding(dataDir: string, input: { name: string; dir: string }): Project {
  const { name, dir } = input;

  // Validate name
  if (!name || name.trim().length === 0) {
    throw new Error('Project name must be non-empty');
  }
  if (name.length > 100) {
    throw new Error('Project name must be 100 characters or fewer');
  }

  // Validate dir exists and is a directory
  const absDir = resolve(dir);
  if (!existsSync(absDir)) {
    throw new Error(`Directory does not exist: ${dir}`);
  }
  const stat = statSync(absDir);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${dir}`);
  }

  // Check for duplicate directory
  const projects = readProjects(dataDir);
  if (projects.some(p => resolve(p.dir) === absDir)) {
    throw new Error(`A project with this directory is already registered: ${dir}`);
  }

  const project: Project = {
    id: randomUUID(),
    name: name.trim(),
    dir: absDir,
    taskFile: 'tasks.md',
    promptFile: detectPromptFile(absDir),
    createdAt: new Date().toISOString(),
    status: 'onboarding',
  };

  projects.push(project);
  writeProjects(dataDir, projects);

  return project;
}

export function removeProject(dataDir: string, id: string): void {
  const projects = readProjects(dataDir);
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) {
    throw new Error(`Project not found: ${id}`);
  }
  projects.splice(idx, 1);
  writeProjects(dataDir, projects);
}
