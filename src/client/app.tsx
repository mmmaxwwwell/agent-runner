import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';

type Route =
  | { page: 'dashboard' }
  | { page: 'project-detail'; id: string }
  | { page: 'session-view'; id: string }
  | { page: 'new-project' }
  | { page: 'settings' };

function parseHash(): Route {
  const hash = window.location.hash || '#/';
  const path = hash.slice(1); // remove '#'

  const projectMatch = path.match(/^\/projects\/([^/]+)$/);
  if (projectMatch) return { page: 'project-detail', id: projectMatch[1]! };

  const sessionMatch = path.match(/^\/sessions\/([^/]+)$/);
  if (sessionMatch) return { page: 'session-view', id: sessionMatch[1]! };

  if (path === '/new') return { page: 'new-project' };
  if (path === '/settings') return { page: 'settings' };

  return { page: 'dashboard' };
}

function App() {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <div>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <a href="#/" style={{ color: '#7c8dff', textDecoration: 'none', fontWeight: 'bold', fontSize: '1.1rem' }}>
          Agent Runner
        </a>
        {route.page !== 'dashboard' && (
          <a href="#/" style={{ color: '#888', textDecoration: 'none', fontSize: '0.85rem' }}>
            Back
          </a>
        )}
      </header>
      <main style={{ padding: '16px' }}>
        {route.page === 'dashboard' && <div>Dashboard — coming soon</div>}
        {route.page === 'project-detail' && <div>Project: {route.id}</div>}
        {route.page === 'session-view' && <div>Session: {route.id}</div>}
        {route.page === 'new-project' && <div>New Project — coming soon</div>}
        {route.page === 'settings' && <div>Settings — coming soon</div>}
      </main>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
