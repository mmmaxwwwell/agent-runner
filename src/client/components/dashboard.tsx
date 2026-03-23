import { useState, useEffect } from 'preact/hooks';
import {
  get,
  post,
  type RegisteredProject,
  type DiscoveredDirectory,
  type ProjectsResponse,
  type OnboardResponse,
  type ActiveSession,
} from '../lib/api.js';
import { connectDashboard, type ProjectUpdateMessage, type ServerMessage } from '../lib/ws.js';
import { navigate } from '../lib/router.js';

function statusBadge(project: RegisteredProject): { label: string; color: string } {
  if (project.status === 'onboarding') return { label: 'onboarding', color: '#2196f3' };
  if (project.status === 'error') return { label: 'error', color: '#f44336' };
  if (!project.activeSession) return { label: 'idle', color: '#666' };
  switch (project.activeSession.state) {
    case 'running':
      return { label: 'running', color: '#4caf50' };
    case 'waiting-for-input':
      return { label: 'waiting', color: '#ff9800' };
    default:
      return { label: project.activeSession.state, color: '#666' };
  }
}

function ProjectCard({ project }: { project: RegisteredProject }) {
  const badge = statusBadge(project);
  const { taskSummary } = project;

  return (
    <div
      onClick={() => navigate(`/projects/${project.id}`)}
      style={{
        border: '1px solid #333',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '12px',
        cursor: 'pointer',
        background: '#1a1a2e',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>{project.name}</span>
        <span
          style={{
            fontSize: '0.75rem',
            padding: '2px 8px',
            borderRadius: '4px',
            background: badge.color,
            color: '#fff',
          }}
        >
          {badge.label}
        </span>
      </div>
      <div style={{ fontSize: '0.85rem', color: '#aaa' }}>
        {taskSummary.completed}/{taskSummary.total} tasks
        {taskSummary.blocked > 0 && (
          <span style={{ color: '#ff9800', marginLeft: '8px' }}>
            {taskSummary.blocked} blocked
          </span>
        )}
      </div>
    </div>
  );
}

function DiscoveredCard({ dir, onOnboarded }: { dir: DiscoveredDirectory; onOnboarded: (dir: DiscoveredDirectory, resp: OnboardResponse) => void }) {
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const handleOnboard = async () => {
    setBusy(true);
    setErrMsg(null);
    try {
      const resp = await post<OnboardResponse>('/projects/onboard', { name: dir.name, path: dir.path });
      onOnboarded(dir, resp);
    } catch (err: unknown) {
      setErrMsg(err instanceof Error ? err.message : 'Onboard failed');
      setBusy(false);
    }
  };

  const { isGitRepo, hasSpecKit } = dir;
  const hasBadges = isGitRepo || hasSpecKit.spec || hasSpecKit.plan || hasSpecKit.tasks;

  return (
    <div
      style={{
        border: '1px dashed #555',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '12px',
        background: '#12121f',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>{dir.name}</span>
        <button
          onClick={handleOnboard}
          disabled={busy}
          style={{
            fontSize: '0.8rem',
            padding: '4px 12px',
            borderRadius: '4px',
            border: '1px solid #7c8dff',
            background: 'transparent',
            color: busy ? '#555' : '#7c8dff',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Onboarding...' : 'Onboard'}
        </button>
      </div>
      {hasBadges && (
        <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
          {isGitRepo && (
            <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: '3px', background: '#2a3a2a', color: '#81c784', border: '1px solid #4caf5044' }}>
              git
            </span>
          )}
          {hasSpecKit.spec && (
            <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: '3px', background: '#1a2a3a', color: '#90caf9', border: '1px solid #2196f344' }}>
              spec
            </span>
          )}
          {hasSpecKit.plan && (
            <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: '3px', background: '#1a2a3a', color: '#90caf9', border: '1px solid #2196f344' }}>
              plan
            </span>
          )}
          {hasSpecKit.tasks && (
            <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: '3px', background: '#1a2a3a', color: '#90caf9', border: '1px solid #2196f344' }}>
              tasks
            </span>
          )}
        </div>
      )}
      {errMsg && (
        <div style={{ color: '#ff8a80', fontSize: '0.8rem', marginTop: '8px' }}>{errMsg}</div>
      )}
    </div>
  );
}

export function Dashboard() {
  const [data, setData] = useState<ProjectsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get<ProjectsResponse>('/projects')
      .then((resp) => {
        setData(resp);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Live updates via WebSocket
  useEffect(() => {
    const client = connectDashboard((msg: ServerMessage) => {
      if (msg.type !== 'project-update') return;
      const update = msg as ProjectUpdateMessage;
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          registered: prev.registered.map((p) =>
            p.id === update.projectId
              ? {
                  ...p,
                  taskSummary: update.taskSummary,
                  activeSession: update.activeSession as ActiveSession | null,
                }
              : p,
          ),
        };
      });
    });
    return () => client.close();
  }, []);

  const handleOnboarded = (dir: DiscoveredDirectory, resp: OnboardResponse) => {
    setData((prev) => {
      if (!prev) return prev;
      const newRegistered: RegisteredProject = {
        type: 'registered',
        id: resp.projectId,
        name: resp.name,
        dir: resp.path,
        taskFile: 'tasks.md',
        createdAt: new Date().toISOString(),
        status: 'onboarding',
        taskSummary: { total: 0, completed: 0, blocked: 0, skipped: 0, remaining: 0 },
        activeSession: null,
        dirMissing: false,
      };
      return {
        ...prev,
        registered: [...prev.registered, newRegistered],
        discovered: prev.discovered.filter((d) => d.path !== dir.path),
      };
    });
  };

  if (loading) return <div>Loading projects...</div>;
  if (error) return <div style={{ color: '#f44336' }}>Error: {error}</div>;
  if (!data) return null;

  const { registered, discovered, discoveryError } = data;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Projects</h2>
        <a
          href="#/new"
          style={{
            color: '#7c8dff',
            textDecoration: 'none',
            fontSize: '0.9rem',
          }}
        >
          + New Project
        </a>
      </div>

      {discoveryError && (
        <div style={{
          background: '#2a1a1a',
          border: '1px solid #f4433666',
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '16px',
          color: '#ff8a80',
          fontSize: '0.85rem',
        }}>
          {discoveryError}
        </div>
      )}

      {registered.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          {registered.map((p) => <ProjectCard key={p.id} project={p} />)}
        </div>
      )}

      {discovered.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#aaa' }}>Discovered</h3>
          {discovered.map((d) => <DiscoveredCard key={d.path} dir={d} onOnboarded={handleOnboarded} />)}
        </div>
      )}

      {registered.length === 0 && discovered.length === 0 && !discoveryError && (
        <div style={{ color: '#888', textAlign: 'center', padding: '32px 0' }}>
          No projects found. <a href="#/new" style={{ color: '#7c8dff' }}>Create one</a> or register via API.
        </div>
      )}
    </div>
  );
}
