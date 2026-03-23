// --- Domain types for GET /api/projects ---

export type TaskSummary = {
  total: number;
  completed: number;
  blocked: number;
  skipped: number;
  remaining: number;
};

export type ActiveSession = {
  id: string;
  type: string;
  state: string;
  startedAt: string;
};

export type RegisteredProject = {
  type: 'registered';
  id: string;
  name: string;
  dir: string;
  taskFile: string;
  createdAt: string;
  status: 'active' | 'onboarding' | 'error';
  taskSummary: TaskSummary;
  activeSession: ActiveSession | null;
  dirMissing: boolean;
};

export type DiscoveredDirectory = {
  type: 'discovered';
  name: string;
  path: string;
  isGitRepo: boolean;
  hasNixFlake: boolean;
  hasSpecKit: {
    spec: boolean;
    plan: boolean;
    tasks: boolean;
  };
};

export type ProjectsResponse = {
  registered: RegisteredProject[];
  discovered: DiscoveredDirectory[];
  discoveryError: string | null;
};

// --- POST /api/projects/onboard ---

export type OnboardRequest = {
  name: string;
  path: string;
};

export type OnboardResponse = {
  projectId: string;
  name: string;
  path: string;
  status: 'onboarding';
};

// --- HTTP helpers ---

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };

  const res = await fetch(`/api${path}`, opts);

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, data.error ?? res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function get<T>(path: string): Promise<T> {
  return request<T>('GET', path);
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body);
}

export function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PUT', path, body);
}

export function del<T>(path: string): Promise<T> {
  return request<T>('DELETE', path);
}
