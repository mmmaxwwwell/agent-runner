import { readFileSync } from 'node:fs';

export interface Task {
  id: string;
  phase: number;
  phaseName: string;
  status: 'unchecked' | 'checked' | 'blocked' | 'skipped';
  description: string;
  blockedReason: string | null;
  depth: number;
}

export interface TaskSummary {
  total: number;
  completed: number;
  blocked: number;
  skipped: number;
  remaining: number;
}

const PHASE_REGEX = /^##\s+Phase\s+(\d+):\s+(.+?)(?:\s+🎯.*)?$/;
const TASK_REGEX = /^(\s*)- \[([ x?~])\]\s+(\d+(?:\.\d+)*)\s+(.+)$/;

const STATUS_MAP: Record<string, Task['status']> = {
  ' ': 'unchecked',
  'x': 'checked',
  '?': 'blocked',
  '~': 'skipped',
};

export function parseTasks(filePath: string): Task[] {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  let currentPhase = 0;
  let currentPhaseName = '';
  const tasks: Task[] = [];

  for (const line of lines) {
    const phaseMatch = line.match(PHASE_REGEX);
    if (phaseMatch) {
      currentPhase = parseInt(phaseMatch[1], 10);
      currentPhaseName = phaseMatch[2].trim();
      continue;
    }

    const taskMatch = line.match(TASK_REGEX);
    if (taskMatch) {
      const indent = taskMatch[1];
      const statusChar = taskMatch[2];
      const id = taskMatch[3];
      const rawDescription = taskMatch[4];
      const status = STATUS_MAP[statusChar];

      const depth = Math.floor(indent.length / 2);

      let description = rawDescription;
      let blockedReason: string | null = null;

      if (status === 'blocked') {
        const blockedIdx = rawDescription.indexOf('— Blocked:');
        if (blockedIdx !== -1) {
          description = rawDescription.substring(0, blockedIdx).trim();
          blockedReason = rawDescription.substring(blockedIdx + '— Blocked:'.length).trim();
        }
      }

      tasks.push({
        id,
        phase: currentPhase,
        phaseName: currentPhaseName,
        status,
        description,
        blockedReason,
        depth,
      });
    }
  }

  return tasks;
}

export function parseTaskSummary(filePath: string): TaskSummary {
  const tasks = parseTasks(filePath);

  const summary: TaskSummary = {
    total: tasks.length,
    completed: 0,
    blocked: 0,
    skipped: 0,
    remaining: 0,
  };

  for (const task of tasks) {
    switch (task.status) {
      case 'checked':
        summary.completed++;
        break;
      case 'blocked':
        summary.blocked++;
        break;
      case 'skipped':
        summary.skipped++;
        break;
      case 'unchecked':
        summary.remaining++;
        break;
    }
  }

  return summary;
}
