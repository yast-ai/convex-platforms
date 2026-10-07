import type { AuthenticationResponseResponse } from '@workos-inc/node';
const endpoint = 'https://api.workos.com/user_management';
export type CliTokens = Pick<AuthenticationResponseResponse, 'access_token' | 'refresh_token' | 'organization_id'>;
async function post(path: string, values: Record<string, string>) {
  const response = await fetch(`${endpoint}/${path}`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
    signal: AbortSignal.timeout(30_000),
  });
  const data: unknown = await response.json().catch(() => {
    throw new Error('WorkOS returned an invalid response.');
  });
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('WorkOS returned an invalid response.');
  return { response, data: data as Record<string, unknown> };
}
function tokens(data: Record<string, unknown>): CliTokens {
  if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string')
    throw new Error('WorkOS returned an invalid session.');
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    ...(typeof data.organization_id === 'string' ? { organization_id: data.organization_id } : {}),
  };
}
/** Public device flow. No WorkOS server key or client secret is used. */
export async function loginCli(clientId: string, display: (url: string, code: string) => void): Promise<CliTokens> {
  const { response, data } = await post('authorize/device', {
    client_id: clientId,
  });
  if (
    !response.ok ||
    typeof data.device_code !== 'string' ||
    typeof data.user_code !== 'string' ||
    typeof data.verification_uri !== 'string' ||
    typeof data.expires_in !== 'number' ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0 ||
    typeof data.interval !== 'number' ||
    !Number.isFinite(data.interval) ||
    data.interval <= 0
  )
    throw new Error('Unable to start WorkOS login.');
  const url = new URL(
    typeof data.verification_uri_complete === 'string' ? data.verification_uri_complete : data.verification_uri,
  );
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Invalid WorkOS verification URL.');
  display(url.href, data.user_code);
  const deadline = Date.now() + Math.min(data.expires_in, 900) * 1000;
  let interval = Math.max(1, data.interval) * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    if (Date.now() >= deadline) break;
    const result = await post('authenticate', {
      client_id: clientId,
      device_code: data.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (result.response.ok) return tokens(result.data);
    if (result.data.error === 'slow_down') interval += 5000;
    else if (result.data.error !== 'authorization_pending')
      throw new Error('WorkOS login failed or was denied. Run login again.');
  }
  throw new Error('WorkOS login timed out. Run login again.');
}
export async function refreshCli(clientId: string, refreshToken: string): Promise<CliTokens> {
  const { response, data } = await post('authenticate', {
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (!response.ok)
    throw Object.assign(new Error('Unable to refresh WorkOS login. Run login again if access was revoked.'), {
      invalidGrant: data.error === 'invalid_grant',
    });
  return tokens(data);
}
