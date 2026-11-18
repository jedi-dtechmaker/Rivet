const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Retry reads only. Callers must explicitly opt into replaying idempotent writes. */
export async function retryRead(operation, { attempts = 3, wait = delay } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      const transient = error?.transient === true || (error?.status !== undefined && TRANSIENT.has(error.status))
        || ['TypeError', 'TimeoutError', 'AbortError'].includes(error?.name);
      if (!transient || attempt + 1 >= attempts) throw error;
      await wait(Math.min(Number.isFinite(error.retryAfter) ? error.retryAfter : 250 * 2 ** attempt, 5000));
    }
  }
}

export function responseError(response, message) {
  const error = new Error(message);
  error.status = response.status;
  const header = response.headers?.get('retry-after');
  if (header) {
    const seconds = Number(header);
    error.retryAfter = Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now());
  }
  return error;
}
