// Generated clients use this transport. A site URL and bearer token are supplied at runtime.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly data: unknown,
  ) {
    super(`Request failed (${status})`);
    this.name = 'ApiError';
  }
}

export async function request<T>(siteUrl: string, token: string, path: string, args: object): Promise<T> {
  const base = new URL(siteUrl);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/' ||
    (base.protocol !== 'https:' &&
      !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))
  )
    throw new Error('Expected an HTTPS site origin; HTTP is allowed only on localhost');
  if (!token || /[\r\n]/.test(token)) throw new Error('A bearer token is required');
  const response = await fetch(new URL(path, base.origin), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (
    !response.ok ||
    !body ||
    typeof body !== 'object' ||
    (body as { status?: unknown }).status !== 'success' ||
    !('value' in body)
  )
    throw new ApiError(response.status, body);
  return (body as { value: T }).value;
}
