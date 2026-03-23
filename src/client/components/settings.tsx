import { useState, useEffect } from 'preact/hooks';
import { get, put } from '../lib/api.js';
import { getBackend, setBackend, isBrowserSpeechAvailable, type VoiceBackend } from '../lib/voice.js';

interface HealthInfo {
  status: string;
  uptime: number;
  sandboxAvailable: boolean;
  cloudSttAvailable: boolean;
}

export function Settings() {
  const [voiceBackend, setVoiceBackend] = useState<VoiceBackend>(getBackend());
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [logLevel, setLogLevel] = useState<string>('info');
  const [pushPermission, setPushPermission] = useState<string>('default');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    get<HealthInfo>('/health')
      .then(setHealth)
      .catch(() => setError('Failed to load server health'));

    if ('Notification' in window) {
      setPushPermission(Notification.permission);
    }
  }, []);

  const handleVoiceBackendChange = (backend: VoiceBackend) => {
    setBackend(backend);
    setVoiceBackend(backend);
  };

  const handleLogLevelChange = async (level: string) => {
    setSaving(true);
    setError(null);
    try {
      await put('/config/log-level', { level });
      setLogLevel(level);
    } catch {
      setError('Failed to update log level');
    } finally {
      setSaving(false);
    }
  };

  const handleRequestPush = async () => {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setPushPermission(result);
  };

  const browserSpeechAvailable = isBrowserSpeechAvailable();
  const cloudSttAvailable = health?.cloudSttAvailable ?? false;

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Settings</h2>

      <section style={{ marginBottom: '24px' }}>
        <h3>Voice Backend</h3>
        <label style={{ display: 'block', marginBottom: '8px', cursor: 'pointer' }}>
          <input
            type="radio"
            name="voice"
            checked={voiceBackend === 'browser'}
            onChange={() => handleVoiceBackendChange('browser')}
            disabled={!browserSpeechAvailable}
          />{' '}
          Browser (Web Speech API)
          {!browserSpeechAvailable && <span style={{ color: '#f44', marginLeft: '8px' }}>unavailable</span>}
        </label>
        <label style={{ display: 'block', cursor: 'pointer' }}>
          <input
            type="radio"
            name="voice"
            checked={voiceBackend === 'cloud'}
            onChange={() => handleVoiceBackendChange('cloud')}
            disabled={!cloudSttAvailable}
          />{' '}
          Google Speech-to-Text (Cloud)
          {!cloudSttAvailable && <span style={{ color: '#f44', marginLeft: '8px' }}>unavailable</span>}
        </label>
      </section>

      <section style={{ marginBottom: '24px' }}>
        <h3>Log Level</h3>
        <select
          value={logLevel}
          onChange={(e) => handleLogLevelChange((e.target as HTMLSelectElement).value)}
          disabled={saving}
          style={{ padding: '4px 8px', background: '#222', color: '#eee', border: '1px solid #555', borderRadius: '4px' }}
        >
          {['debug', 'info', 'warn', 'error', 'fatal'].map((level) => (
            <option key={level} value={level}>{level}</option>
          ))}
        </select>
      </section>

      <section style={{ marginBottom: '24px' }}>
        <h3>Push Notifications</h3>
        <p>Permission: <strong>{pushPermission}</strong></p>
        {pushPermission === 'default' && (
          <button
            onClick={handleRequestPush}
            style={{ padding: '6px 12px', background: '#335', color: '#eee', border: '1px solid #557', borderRadius: '4px', cursor: 'pointer' }}
          >
            Enable Notifications
          </button>
        )}
        {pushPermission === 'denied' && (
          <p style={{ color: '#f44' }}>Notifications are blocked. Update your browser settings to enable them.</p>
        )}
      </section>

      <section style={{ marginBottom: '24px' }}>
        <h3>Server Info</h3>
        {health ? (
          <div>
            <p>Status: {health.status}</p>
            <p>Uptime: {Math.floor(health.uptime)}s</p>
            <p>Sandbox: {health.sandboxAvailable ? 'available' : 'unavailable'}</p>
          </div>
        ) : (
          <p style={{ color: '#888' }}>Loading...</p>
        )}
      </section>

      <section>
        <h3>About</h3>
        <p>Agent Runner v0.1.0</p>
      </section>

      {error && <p style={{ color: '#f44' }}>{error}</p>}
    </div>
  );
}
