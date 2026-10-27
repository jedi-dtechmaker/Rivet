export class ManifestWaitError extends Error {
  constructor(public readonly stage: 'wallet' | 'server', cancelled = false) {
    super(stage === 'wallet'
      ? `${cancelled ? 'Stopped waiting for' : 'Timed out waiting for'} JoyID. Close the old JoyID window before retrying. Your prepared transaction is saved; this attempt did not submit it.`
      : 'The server is taking longer than expected. Your approved transaction is retained. Refresh manifest status before retrying; it may already have been submitted.');
    this.name = 'ManifestWaitError';
  }
}

/** A late wallet result must never resume a cancelled/timed-out submission. */
export async function waitForManifestStep<T>(
  work: Promise<T>, stage: 'wallet' | 'server', timeoutMs: number, signal?: AbortSignal,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      abort = () => reject(new ManifestWaitError(stage, true));
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => reject(new ManifestWaitError(stage)), timeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}
