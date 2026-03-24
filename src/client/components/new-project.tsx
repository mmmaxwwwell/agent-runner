import { useState } from 'preact/hooks';
import { onboardProject, type OnboardRequest } from '../lib/api.js';
import { navigate } from '../lib/router.js';

type GitRemoteOption = 'skip' | 'remote-url' | 'create-github';

export function NewProject() {
  const [name, setName] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Git remote modal state
  const [showGitModal, setShowGitModal] = useState(false);

  const handleGo = () => {
    if (!name.trim() || starting) return;
    setShowGitModal(true);
  };

  const handleConfirm = async (option: GitRemoteOption, remoteUrl?: string) => {
    setShowGitModal(false);
    setStarting(true);
    setError(null);

    try {
      const body: OnboardRequest = {
        name: name.trim(),
        newProject: true,
      };
      if (option === 'remote-url' && remoteUrl) {
        body.remoteUrl = remoteUrl;
      } else if (option === 'create-github') {
        body.createGithubRepo = true;
      }
      await onboardProject(body);
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start project');
      setStarting(false);
    }
  };

  return (
    <div>
      <h2 style={{ margin: '0 0 16px 0', fontSize: '1.2rem' }}>New Project</h2>

      {error && (
        <div style={{ color: '#f44336', marginBottom: '12px', fontSize: '0.85rem' }}>{error}</div>
      )}

      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontSize: '0.85rem', color: '#aaa', marginBottom: '4px' }}>
          Repository name
        </label>
        <input
          type="text"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder="my-project"
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '4px',
            border: '1px solid #555',
            background: '#1a1a2e',
            color: '#ddd',
            fontSize: '0.9rem',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <button
        onClick={handleGo}
        disabled={starting || !name.trim()}
        style={{
          padding: '10px 24px',
          background: starting || !name.trim() ? '#555' : '#7c8dff',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: starting || !name.trim() ? 'default' : 'pointer',
          fontSize: '0.9rem',
        }}
      >
        {starting ? 'Starting...' : 'Go'}
      </button>

      {showGitModal && (
        <GitRemoteModal
          dirName={name.trim()}
          onConfirm={handleConfirm}
          onCancel={() => setShowGitModal(false)}
        />
      )}
    </div>
  );
}

function GitRemoteModal({ dirName, onConfirm, onCancel }: {
  dirName: string;
  onConfirm: (option: GitRemoteOption, remoteUrl?: string) => void;
  onCancel: () => void;
}) {
  const [option, setOption] = useState<GitRemoteOption>('skip');
  const [remoteUrl, setRemoteUrl] = useState('');

  const handleSubmit = () => {
    if (option === 'remote-url' && !remoteUrl.trim()) return;
    onConfirm(option, option === 'remote-url' ? remoteUrl.trim() : undefined);
  };

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.6)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        onClick={(e: Event) => e.stopPropagation()}
        style={{
          background: '#1a1a2e', border: '1px solid #333', borderRadius: '8px',
          padding: '24px', width: '400px', maxWidth: '90vw',
        }}
      >
        <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem' }}>
          Git Remote Setup — {dirName}
        </h3>

        <label style={{ display: 'block', marginBottom: '12px', cursor: 'pointer' }}>
          <input
            type="radio" name="git-remote" checked={option === 'skip'}
            onChange={() => setOption('skip')}
            style={{ marginRight: '8px' }}
          />
          Skip — no remote
        </label>

        <label style={{ display: 'block', marginBottom: '8px', cursor: 'pointer' }}>
          <input
            type="radio" name="git-remote" checked={option === 'remote-url'}
            onChange={() => setOption('remote-url')}
            style={{ marginRight: '8px' }}
          />
          Enter remote URL
        </label>
        {option === 'remote-url' && (
          <input
            type="text" value={remoteUrl}
            onInput={(e: Event) => setRemoteUrl((e.target as HTMLInputElement).value)}
            placeholder="git@github.com:user/repo.git"
            style={{
              width: '100%', padding: '6px 8px', marginBottom: '12px',
              background: '#12121f', border: '1px solid #555', borderRadius: '4px',
              color: '#eee', fontSize: '0.85rem', boxSizing: 'border-box',
            }}
          />
        )}

        <label style={{ display: 'block', marginBottom: '16px', cursor: 'pointer' }}>
          <input
            type="radio" name="git-remote" checked={option === 'create-github'}
            onChange={() => setOption('create-github')}
            style={{ marginRight: '8px' }}
          />
          Create GitHub repo (via gh CLI)
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '6px 16px', borderRadius: '4px', border: '1px solid #555',
              background: 'transparent', color: '#aaa', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={option === 'remote-url' && !remoteUrl.trim()}
            style={{
              padding: '6px 16px', borderRadius: '4px', border: '1px solid #7c8dff',
              background: '#7c8dff22', color: '#7c8dff', cursor: 'pointer',
            }}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
