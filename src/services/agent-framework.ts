import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { AGENT_FRAMEWORK_REPO } from '../lib/config.js';

/**
 * Ensures the agent-framework repo is cloned and up-to-date at <dataDir>/agent-framework/.
 * Clones if missing, pulls if exists. Creates dataDir recursively if needed.
 */
export function ensureAgentFramework(dataDir: string, repoUrl: string = AGENT_FRAMEWORK_REPO): void {
  mkdirSync(dataDir, { recursive: true });

  const agentFwDir = join(dataDir, 'agent-framework');

  if (existsSync(join(agentFwDir, '.git'))) {
    // Pull latest — fetch first, then merge only if upstream exists
    try {
      execFileSync('git', ['-C', agentFwDir, 'fetch'], { stdio: 'pipe' });
      // Merge only if there's an upstream branch to merge from
      try {
        execFileSync('git', ['-C', agentFwDir, 'merge', '--ff-only', '@{u}'], { stdio: 'pipe' });
      } catch {
        // No upstream configured or nothing to merge — that's fine
      }
    } catch (e: unknown) {
      const msg = (e as Error).message || String(e);
      throw new Error(`Failed to pull agent-framework updates: ${msg}`);
    }
  } else {
    // Clone fresh
    try {
      execFileSync('git', ['clone', repoUrl, agentFwDir], {
        stdio: 'pipe',
      });
    } catch (e: unknown) {
      // Clean up partial clone
      if (existsSync(agentFwDir)) {
        rmSync(agentFwDir, { recursive: true, force: true });
      }
      const msg = (e as Error).message || String(e);
      throw new Error(`Failed to clone agent-framework: ${msg}`);
    }
  }
}
