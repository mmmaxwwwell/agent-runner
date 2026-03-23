import { access, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DiscoveredDirectory } from '../models/project.ts';

/**
 * Check whether a directory contains a Nix flake (flake.nix file).
 */
export async function detectNixFlake(dirPath: string): Promise<boolean> {
  try {
    await access(join(dirPath, 'flake.nix'));
    return true;
  } catch {
    return false;
  }
}

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
export async function detectSpecKitArtifacts(dirPath: string): Promise<DiscoveredDirectory['hasSpecKit']> {
  const result = { spec: false, plan: false, tasks: false };
  const specsDir = join(dirPath, 'specs');

  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(specsDir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subDir = join(specsDir, entry.name);
    if (!result.spec) {
      try { await access(join(subDir, 'spec.md')); result.spec = true; } catch { /* skip */ }
    }
    if (!result.plan) {
      try { await access(join(subDir, 'plan.md')); result.plan = true; } catch { /* skip */ }
    }
    if (!result.tasks) {
      try { await access(join(subDir, 'tasks.md')); result.tasks = true; } catch { /* skip */ }
    }
    if (result.spec && result.plan && result.tasks) break;
  }

  return result;
}

/**
 * Scan the projects directory for top-level directories that are not already registered.
 * Returns metadata about each discovered directory including git and spec-kit status.
 */
export async function scanProjectsDir(
  projectsDir: string,
  registeredPaths: Set<string>,
): Promise<DiscoveredDirectory[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: DiscoveredDirectory[] = [];

  for (const entry of entries) {
    // Skip hidden directories
    if (entry.name.startsWith('.')) continue;

    const fullPath = resolve(join(projectsDir, entry.name));

    // Check if it's a directory (follow symlinks via stat)
    try {
      const stats = await stat(fullPath);
      if (!stats.isDirectory()) continue;
    } catch {
      // Broken symlink or permission error — skip
      continue;
    }

    // Skip already-registered directories
    if (registeredPaths.has(fullPath)) continue;

    const [isGitRepo, hasNixFlake, hasSpecKit] = await Promise.all([
      detectGitRepo(fullPath),
      detectNixFlake(fullPath),
      detectSpecKitArtifacts(fullPath),
    ]);

    results.push({
      type: 'discovered',
      name: entry.name,
      path: fullPath,
      isGitRepo,
      hasNixFlake,
      hasSpecKit,
    });
  }

  return results;
}
