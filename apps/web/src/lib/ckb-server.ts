import { ccc } from '@ckb-ccc/core';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export class CkbHttpTransport implements ccc.JsonRpcTransport {
  private readonly endpoint: URL;

  constructor(url: string, private readonly timeout = 30000, private readonly family?: 4 | 6) {
    this.endpoint = new URL(url);
    if (!['http:', 'https:'].includes(this.endpoint.protocol)) throw new Error('CKB RPC requires an HTTP or HTTPS endpoint.');
  }

  async request(payload: ccc.JsonRpcPayload): Promise<ccc.JsonRpcResponse> {
    const send = this.endpoint.protocol === 'https:' ? httpsRequest : httpRequest;
    const body = JSON.stringify(payload);
    return new Promise((resolve, reject) => {
      const request = send(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        family: this.family,
        signal: AbortSignal.timeout(this.timeout),
      }, response => {
        let content = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { content += chunk; });
        response.on('error', reject);
        response.on('end', () => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error('CKB testnet RPC is unavailable. Please retry shortly.'));
            return;
          }
          try { resolve(JSON.parse(content)); }
          catch { reject(new Error('CKB testnet RPC returned an invalid response.')); }
        });
      });
      request.on('error', error => reject(new Error('CKB testnet RPC could not be reached. Please retry shortly.', { cause: error })));
      request.end(body);
    });
  }
}

export function createTestnetClient() {
  const family = process.env.CKB_RPC_IP_FAMILY;
  if (family && family !== '4' && family !== '6') throw new Error('CKB_RPC_IP_FAMILY must be 4 or 6.');
  return ccc.ClientPublicTestnet.new({
    transport: new CkbHttpTransport(process.env.CKB_TESTNET_RPC_URL || 'https://testnet.ckb.dev/', 30000, family === '4' ? 4 : family === '6' ? 6 : undefined),
  });
}
