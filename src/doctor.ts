import { siteOrigin } from './transport.js';
export async function doctor(site: string) {
  const origin = siteOrigin(site);
  const endpoints = ['/cli/config', '/cli/manifest', '/api-reference/openapi.json', '/.well-known/oauth-protected-resource/mcp'];
  let failed = false;
  for (const path of endpoints) {
    const response = await fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok || !value || typeof value !== 'object') { failed = true; console.log(`FAIL ${path} (${response.status})`); }
    else console.log(`OK ${path}`);
  }
  const response = await fetch(origin + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'convex-platforms-doctor', version: '0.1.0' } } }), redirect: 'error', signal: AbortSignal.timeout(30_000) });
  const challenge = response.headers.get('www-authenticate');
  if (response.status !== 401 || !challenge?.includes(`${origin}/.well-known/oauth-protected-resource/mcp`)) { failed = true; console.log(`FAIL MCP auth challenge (${response.status})`); }
  else console.log('OK MCP authentication discovery');
  if (failed) throw new Error('Deployment checks failed. Review WorkOS Connect configuration and generated routes.');
  console.log('Public wiring verified. Run an authenticated operation in each target host to verify access.');
}
