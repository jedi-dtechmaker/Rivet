export const trackedPages = ['home', 'explore', 'docs', 'about', 'verify', 'dashboard', 'identity'] as const;
export type TrackedPage = typeof trackedPages[number];

export function trackedPage(pathname: string): TrackedPage | null {
  const pages: Record<string, TrackedPage> = {
    '/': 'home', '/explore': 'explore', '/docs': 'docs', '/about': 'about',
    '/verify': 'verify', '/dashboard': 'dashboard', '/dashboard/identity': 'identity',
  };
  return pages[pathname] ?? null;
}

export function isTrackedPage(value: unknown): value is TrackedPage {
  return typeof value === 'string' && (trackedPages as readonly string[]).includes(value);
}

export function isAdminGithubId(id: unknown, configured: string | undefined): boolean {
  if (typeof id !== 'string' || !/^\d+$/.test(id) || !configured) return false;
  return configured.split(',').map(value => value.trim()).some(value => /^\d+$/.test(value) && value === id);
}
