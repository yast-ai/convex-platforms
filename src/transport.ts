export class ApiError extends Error {
  constructor(
    public status: number,
    public data: unknown,
  ) {
    super(`Request failed (${status})`);
    this.name = 'ApiError';
  }
}
export function siteOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new Error('Use an HTTPS site origin. HTTP is allowed only on localhost.');
  return url.origin;
}
export async function request<T>(url: string, token: string, path: string, args: object): Promise<T> {
  const origin = siteOrigin(url);
  if (!/^\/api\/v1\/(?:[a-z][a-zA-Z0-9]*\/)*[a-z][a-zA-Z0-9]*$/.test(path))
    throw new Error('Invalid operation route');
  if (!token || /[\r\n]/.test(token)) throw new Error('A bearer token is required');
  const response = await fetch(new URL(path, origin), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const result: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    !result ||
    typeof result !== 'object' ||
    !('status' in result) ||
    result.status !== 'success' ||
    !('value' in result)
  )
    throw new ApiError(response.status, result);
  return result.value as T;
}
