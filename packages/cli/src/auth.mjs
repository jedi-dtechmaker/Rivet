import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { validToken } from './config.mjs';
import { retryRead, responseError } from './retry.mjs';

export async function readToken({ tokenStdin, env, input, output }) {
  let token;
  if (tokenStdin) {
    let text = '';
    for await (const chunk of input) {
      text += chunk.toString();
      if (text.length > 4096) throw new Error('Invalid GitHub token.');
    }
    token = text.trim();
  } else if (env.RIVET_TOKEN) token = env.RIVET_TOKEN;
  else {
    if (!input.isTTY) throw new Error('Use rivet login --token-stdin for piped input, or run rivet login in a terminal.');
    // Suppress readline echo entirely; tokens never enter shell history or logs.
    const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const reader = createInterface({ input, output: muted, terminal: true, historySize: 0 });
    const controller = new AbortController();
    reader.once('SIGINT', () => controller.abort());
    reader.once('close', () => controller.abort());
    output.write('GitHub personal token for your Rivet account (hidden): ');
    try { token = (await reader.question('', { signal: controller.signal })).trim(); }
    catch { throw new Error('Sign-in cancelled.'); }
    finally { reader.close(); output.write('\n'); }
  }
  if (!validToken(token)) throw new Error('Invalid GitHub token.');
  return token;
}

export function serverRequest(server, token, request = fetch) {
  return async (path, init = {}) => {
    const perform = async () => {
    let response;
    try {
      response = await request(new URL(path, server), { ...init, redirect: 'error',
        headers: { ...init.headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
    } catch { const error = new Error('Could not reach the Rivet server. Check connectivity and the selected server.'); error.transient = true; throw error; }
    if (response.status === 401) throw new Error('Sign-in was rejected. Sign into the web app with GitHub first, then run rivet login with a token for the same account.');
    if (!response.ok) {
      throw responseError(response, `Rivet request failed (HTTP ${response.status}). Check account access, backup status and server availability.`);
    }
    try { return await response.json(); }
    catch { throw new Error('The Rivet server returned an invalid response.'); }
    };
    return !init.method || init.method === 'GET' ? retryRead(perform) : perform();
  };
}
