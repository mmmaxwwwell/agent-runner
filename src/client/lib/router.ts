import { useState, useEffect } from 'preact/hooks';

export type Route =
  | { page: 'dashboard' }
  | { page: 'project-detail'; id: string }
  | { page: 'session-view'; id: string }
  | { page: 'new-project' }
  | { page: 'settings' };

export function parseHash(hash?: string): Route {
  const h = hash ?? window.location.hash ?? '#/';
  const path = h.slice(1); // remove '#'

  const projectMatch = path.match(/^\/projects\/([^/]+)$/);
  if (projectMatch) return { page: 'project-detail', id: projectMatch[1]! };

  const sessionMatch = path.match(/^\/sessions\/([^/]+)$/);
  if (sessionMatch) return { page: 'session-view', id: sessionMatch[1]! };

  if (path === '/new') return { page: 'new-project' };
  if (path === '/settings') return { page: 'settings' };

  return { page: 'dashboard' };
}

export function navigate(path: string): void {
  window.location.hash = path;
}

export function useRouter(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash());

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}
