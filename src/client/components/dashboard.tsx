import { useState, useEffect } from 'preact/hooks';
import { get } from '../lib/api.js';
import { connectDashboard, type ProjectUpdateMessage, type ServerMessage } from '../lib/ws.js';
import { navigate } from '../lib/router.js';

type TaskSummary = {
  total: number;
  completed: number;
  blocked: number;
  skipped: number;
  remaining: number;
};

type ActiveSession = {
  id: string;
  type: string;
  state: string;
  startedAt: string;
};

type Project = {
  id: string;
  name: string;
  dir: string;
  taskFile: string;
  createdAt: string;
  taskSummary: TaskSummary;
  activeSession: ActiveSession | null;
};

function statusBadge(project: Project): { label: string; color: string } {
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

function ProjectCard({ project }: { project: Project }) {
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

export function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    get<Project[]>('/projects')
      .then((data) => {
        setProjects(data);
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
      setProjects((prev) =>
        prev.map((p) =>
          p.id === update.projectId
            ? {
                ...p,
                taskSummary: update.taskSummary,
                activeSession: update.activeSession as ActiveSession | null,
              }
            : p,
        ),
      );
    });
    return () => client.close();
  }, []);

  if (loading) return <div>Loading projects...</div>;
  if (error) return <div style={{ color: '#f44336' }}>Error: {error}</div>;

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
      {projects.length === 0 ? (
        <div style={{ color: '#888', textAlign: 'center', padding: '32px 0' }}>
          No projects registered. <a href="#/new" style={{ color: '#7c8dff' }}>Create one</a> or register via API.
        </div>
      ) : (
        projects.map((p) => <ProjectCard key={p.id} project={p} />)
      )}
    </div>
  );
}
