import { render } from 'preact';
import { useRouter } from './lib/router.js';
import { Dashboard } from './components/dashboard.js';
import { ProjectDetail } from './components/project-detail.js';
import { SessionView } from './components/session-view.js';
import { NewProject } from './components/new-project.js';
import { AddFeature } from './components/add-feature.js';

function App() {
  const route = useRouter();

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
        {route.page === 'dashboard' && <Dashboard />}
        {route.page === 'project-detail' && <ProjectDetail id={route.id} />}
        {route.page === 'session-view' && <SessionView id={route.id} />}
        {route.page === 'new-project' && <NewProject />}
        {route.page === 'add-feature' && <AddFeature projectId={route.id} />}
        {route.page === 'settings' && <div>Settings — coming soon</div>}
      </main>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
