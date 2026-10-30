import { LEGACY_BLOCKED } from '@/lib/identity-proof';

export function cotaRecordFailure(error: unknown) {
  const fields = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const code = typeof fields.code === 'number' || typeof fields.code === 'string' ? fields.code : undefined;
  const detail = typeof fields.data === 'string' ? fields.data : error instanceof Error ? error.message : '';
  const script = detail.match(/source: (Inputs|Outputs)\[(\d+)\]\.(Lock|Type), cause: ValidationFailure: see error code (-?\d+) on page https:\/\/nervosnetwork\.github\.io\/ckb-script-error-codes\/by-(type|data)-hash\/([a-f0-9]{64})\.html/);
  const diagnostics: Record<string, string | number | undefined> = {
    code, name: error instanceof Error ? error.name : undefined,
  };
  if (code === 'IDENTITY_FORMAT_UNSUPPORTED') return { status: 422, diagnostics, message: LEGACY_BLOCKED };
  if (['P1001', 'P1002', 'P2024', 'P2028'].includes(String(code)) || /^(Connection terminated due to connection timeout|Connection terminated unexpectedly|timeout exceeded when trying to connect)$/.test(detail)) {
    return { status: 503, diagnostics, message: 'The database connection timed out. Your prepared proof is preserved. Retry approval or submission shortly.' };
  }
  let cause = fields.cause;
  for (let depth = 0; depth < 5 && cause && typeof cause === 'object'; depth++) {
    const nested = cause as Record<string, unknown>;
    if (typeof nested.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(nested.code)) diagnostics.causeCode = nested.code;
    cause = nested.cause;
  }
  if (error instanceof Error && /^CKB testnet RPC (could not be reached|is unavailable|returned an invalid response)\./.test(error.message)) {
    return { status: 503, diagnostics, message: `${error.message} Your saved identity update is preserved.` };
  }
  if (code !== -302) return { status: 503, diagnostics, message: undefined };
  let message = 'The identity transaction failed testnet validation. The saved update needs review before retrying.';
  if (script) {
    const [, source, index, kind, scriptCode, hashType, scriptHash] = script;
    Object.assign(diagnostics, { source, index, kind, scriptCode: Number(scriptCode), hashType, scriptHash });
    const joyId = source === 'Inputs' && kind === 'Lock' && hashType === 'type' &&
      scriptHash === 'd23761b364210735c19c60561d213fb3beae2fd6172743719eff6920e020baac';
    message = `The identity transaction failed ${joyId ? 'JoyID lock' : 'script'} verification at ${source === 'Inputs' ? 'input' : 'output'} ${index} (script error ${scriptCode}). The saved update needs review before retrying.`;
  }
  return { status: 422, diagnostics, message };
}
