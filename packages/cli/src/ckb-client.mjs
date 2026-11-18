import { retryRead, responseError } from './retry.mjs';

/** Use a single explicit HTTP endpoint. Writes are reconciled by saved transaction hash. */
export function createCkbClient(ccc, url, request = fetch) {
  const endpoint = new URL(url);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Use an HTTP or HTTPS CKB RPC endpoint.');
  return ccc.ClientPublicTestnet.new({ transport: { request: payload => {
    const perform = async () => {
      const response = await request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw responseError(response, 'CKB RPC is unavailable.');
      return response.json();
    };
    return payload.method.startsWith('get_') ? retryRead(perform) : perform();
  } } });
}
