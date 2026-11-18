import { retryRead, responseError } from '../../../../packages/cli/src/retry.mjs';

export async function configureRepositoryHook(repository: string, token: string, enabled: boolean) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL, secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!appUrl || (enabled && !secret)) throw new Error('Webhook configuration is unavailable.');
  const webhookUrl = `${appUrl.replace(/\/$/, '')}/api/webhook/github`;
  const base = `https://api.github.com/repos/${repository}/hooks`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  const read = (url: string) => retryRead(async () => {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw responseError(response, 'GitHub could not list repository webhooks.');
    return response;
  });
  let url: string | undefined = base, existing: { id: number } | undefined;
  for (let page = 0; url; page++) {
    if (page >= 20) throw new Error('Repository webhook pagination exceeded its limit.');
    const response = await read(url), hooks = await response.json();
    if (!Array.isArray(hooks)) throw new Error('GitHub returned invalid webhooks.');
    existing = hooks.find(hook => hook?.config?.url === webhookUrl);
    if (existing) break;
    const next = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') || '')?.[1];
    if (next) {
      const parsed = new URL(next);
      if (parsed.origin !== 'https://api.github.com' || parsed.pathname !== new URL(base).pathname) throw new Error('GitHub webhook pagination changed origin.');
    }
    url = next;
  }
  if (!enabled && !existing) return;
  if (existing && !Number.isSafeInteger(existing.id)) throw new Error('GitHub returned an invalid webhook ID.');
  const response = await fetch(existing ? `${base}/${existing.id}` : base, {
    method: enabled ? existing ? 'PATCH' : 'POST' : 'DELETE', headers, signal: AbortSignal.timeout(15000), redirect: 'error',
    ...(enabled ? { body: JSON.stringify({ name: 'web', active: true, events: ['push'], config: { url: webhookUrl, content_type: 'json', secret } }) } : {}),
  });
  if (!response.ok) throw new Error('GitHub could not update the repository webhook.');
}
