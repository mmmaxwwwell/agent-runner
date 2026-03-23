import { useState, useEffect } from 'preact/hooks';
import { get, post } from '../lib/api.js';
import { navigate } from '../lib/router.js';

type TaskSummary = {
  total: number;
  completed: number;
  blocked: number;
  skipped: number;
  remaining: number;
};

type Task = {
  id: string;
  phase: number;
  phaseName: string;
  status: 'unchecked' | 'checked' | 'blocked' | 'skipped';
  description: string;
  blockedReason: string | null;
  depth: number;
};

type ActiveSession = {
  id: string;
  type: string;
  state: string;
  startedAt: string;
};

type SessionSummary = {
  id: string;
  type: string;
  state: string;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
};

type ProjectDetail = {
  id: string;
  name: string;
  dir: string;
  taskFile: string;
  promptFile: string;
  createdAt: string;
  taskSummary: TaskSummary;
  tasks: Task[];
  activeSession: ActiveSession | null;
  sessions: SessionSummary[];
};

const statusIcon: Record<string, string> = {
  checked: '[x]',
  unchecked: '[ ]',
  blocked: '[?]',
  skipped: '[~]',
};

const statusColor: Record<string, string> = {
  checked: '#4caf50',
  unchecked: '#888',
  blocked: '#ff9800',
  skipped: '#666',
};

const sessionStateColor: Record<string, string> = {
  running: '#4caf50',
  'waiting-for-input': '#ff9800',
  completed: '#666',
  failed: '#f44336',
};

function TaskItem({ task }: { task: Task }) {
  return (
    <div
      style={{
        padding: '4px 0',
        paddingLeft: `${task.depth * 16}px`,
        fontSize: '0.85rem',
        color: task.status === 'checked' || task.status === 'skipped' ? '#666' : '#ccc',
      }}
    >
      <span style={{ color: statusColor[task.status], fontFamily: 'monospace', marginRight: '8px' }}>
        {statusIcon[task.status]}
      </span>
      <span style={{ color: '#888', marginRight: '6px' }}>{task.id}</span>
      {task.description}
      {task.blockedReason && (
        <div style={{ color: '#ff9800', fontSize: '0.8rem', marginLeft: '32px', marginTop: '2px' }}>
          {task.blockedReason}
        </div>
      )}
    </div>
  );
}

function SessionRow({ session }: { session: SessionSummary }) {
  const stateColor = sessionStateColor[session.state] ?? '#666';
  const date = new Date(session.startedAt).toLocaleString();

  return (
    <div
      onClick={() => navigate(`/sessions/${session.id}`)}
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid #333',
        cursor: 'pointer',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '0.85rem',
      }}
    >
      <div>
        <span style={{ color: '#aaa' }}>{session.type}</span>
        <span style={{ color: '#666', marginLeft: '8px' }}>{date}</span>
      </div>
      <span
        style={{
          fontSize: '0.75rem',
          padding: '2px 8px',
          borderRadius: '4px',
          background: stateColor,
          color: '#fff',
        }}
      >
        {session.state}
      </span>
    </div>
  );
}

export function ProjectDetail({ id }: { id: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const fetchProject = () => {
    get<ProjectDetail>(`/projects/${id}`)
      .then((data) => {
        setProject(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchProject();
  }, [id]);

  const startSession = async () => {
    setStarting(true);
    try {
      await post(`/projects/${id}/sessions`, { type: 'task-run' });
      fetchProject();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const stopSession = async () => {
    if (!project?.activeSession) return;
    setStopping(true);
    try {
      await post(`/sessions/${project.activeSession.id}/stop`);
      fetchProject();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStopping(false);
    }
  };

  if (loading) return <div>Loading project...</div>;
  if (error && !project) return <div style={{ color: '#f44336' }}>Error: {error}</div>;
  if (!project) return <div style={{ color: '#f44336' }}>Project not found</div>;

  const { taskSummary, tasks, activeSession, sessions } = project;

  // Group tasks by phase
  const phases = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = `Phase ${task.phase}: ${task.phaseName}`;
    const list = phases.get(key) ?? [];
    list.push(task);
    phases.set(key, list);
  }

  return (
    <div>
      {error && (
        <div style={{ color: '#f44336', marginBottom: '12px', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ margin: '0 0 4px 0', fontSize: '1.2rem' }}>{project.name}</h2>
        <div style={{ color: '#888', fontSize: '0.8rem' }}>{project.dir}</div>
      </div>

      {/* Task progress */}
      <div style={{ marginBottom: '16px', padding: '12px', background: '#1a1a2e', borderRadius: '8px', border: '1px solid #333' }}>
        <div style={{ fontSize: '0.9rem', marginBottom: '8px' }}>
          <strong>{taskSummary.completed}</strong>/{taskSummary.total} tasks completed
          {taskSummary.blocked > 0 && (
            <span style={{ color: '#ff9800', marginLeft: '12px' }}>
              {taskSummary.blocked} blocked
            </span>
          )}
          {taskSummary.skipped > 0 && (
            <span style={{ color: '#666', marginLeft: '12px' }}>
              {taskSummary.skipped} skipped
            </span>
          )}
        </div>
        {taskSummary.total > 0 && (
          <div style={{ background: '#333', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${(taskSummary.completed / taskSummary.total) * 100}%`,
                height: '100%',
                background: '#4caf50',
                borderRadius: '4px',
              }}
            />
          </div>
        )}
      </div>

      {/* Session controls */}
      <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        {activeSession ? (
          <>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '2px 8px',
                borderRadius: '4px',
                background: sessionStateColor[activeSession.state] ?? '#666',
                color: '#fff',
              }}
            >
              {activeSession.state}
            </span>
            <button
              onClick={() => navigate(`/sessions/${activeSession.id}`)}
              style={{
                padding: '6px 16px',
                background: '#7c8dff',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              View Session
            </button>
            {activeSession.state === 'running' && (
              <button
                onClick={stopSession}
                disabled={stopping}
                style={{
                  padding: '6px 16px',
                  background: '#f44336',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  opacity: stopping ? 0.6 : 1,
                }}
              >
                {stopping ? 'Stopping...' : 'Stop'}
              </button>
            )}
          </>
        ) : (
          <>
            <button
              onClick={startSession}
              disabled={starting || taskSummary.remaining === 0}
              style={{
                padding: '6px 16px',
                background: taskSummary.remaining === 0 ? '#666' : '#4caf50',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: taskSummary.remaining === 0 ? 'default' : 'pointer',
                fontSize: '0.85rem',
                opacity: starting ? 0.6 : 1,
              }}
            >
              {starting ? 'Starting...' : taskSummary.remaining === 0 ? 'All Tasks Done' : 'Start Task Run'}
            </button>
            <button
              onClick={() => navigate(`/projects/${id}/add-feature`)}
              style={{
                padding: '6px 16px',
                background: '#7c8dff',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              Add Feature
            </button>
          </>
        )}
      </div>

      {/* Task list */}
      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem' }}>Tasks</h3>
        {Array.from(phases.entries()).map(([phaseName, phaseTasks]) => (
          <div key={phaseName} style={{ marginBottom: '12px' }}>
            <div style={{ fontWeight: 'bold', fontSize: '0.85rem', color: '#aaa', marginBottom: '4px' }}>
              {phaseName}
            </div>
            {phaseTasks.map((task) => (
              <TaskItem key={task.id} task={task} />
            ))}
          </div>
        ))}
        {tasks.length === 0 && (
          <div style={{ color: '#888', fontSize: '0.85rem' }}>No tasks found</div>
        )}
      </div>

      {/* Session history */}
      {sessions.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem' }}>Session History</h3>
          <div style={{ border: '1px solid #333', borderRadius: '8px', overflow: 'hidden' }}>
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
