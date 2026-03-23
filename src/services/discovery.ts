import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { DiscoveredDirectory } from '../models/project.ts';

/**
 * Check whether a directory is a git repository (contains .git file or directory).
 */
export async function detectGitRepo(dirPath: string): Promise<boolean> {
  try {
    await access(join(dirPath, '.git'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan a directory for spec-kit artifacts (spec.md, plan.md, tasks.md) in specs subdirectories.
 */
export async function detectSpecKitArtifacts(_dirPath: string): Promise<DiscoveredDirectory['hasSpecKit']> {
  throw new Error('Not implemented');
}

/**
 * Scan the projects directory for top-level directories that are not already registered.
 * Returns metadata about each discovered directory including git and spec-kit status.
 */
export async function scanProjectsDir(
  _projectsDir: string,
  _registeredPaths: Set<string>,
): Promise<DiscoveredDirectory[]> {
  throw new Error('Not implemented');
}
