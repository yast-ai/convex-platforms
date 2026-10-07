import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, unlink, open, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { constants } from 'node:fs';
import { siteOrigin } from './transport.js';
import { join } from 'node:path';
import { loginCli, refreshCli, type CliTokens } from './workos.js';

type AuthConfig = { clientId: string };
type SavedSession = AuthConfig & {
  refreshToken: string;
  organizationId: string;
};
/** Origin-scoped, private local session. Serialize refreshes to protect rotating tokens. */
export type SessionOptions = { directory?: string; fetch?: typeof fetch; login?: typeof loginCli; refresh?: typeof refreshCli };
export async function sessionToken(origin: string, command: 'login' | 'logout' | 'token', options: SessionOptions = {}): Promise<string> {
  origin = siteOrigin(origin);
  const directory = options.directory ?? join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'convex-platforms');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0))
    throw new Error('CLI session directory must be private (mode 0700).');
  const file = join(directory, `${createHash('sha256').update(origin).digest('hex')}.json`);
  const lock = await acquireSessionLock(`${file}.lock`);
  try {
    if (command === 'logout') {
      await unlink(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      return '';
    }
    const response = await (options.fetch ?? fetch)(`${origin}/cli/config`, {
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    const auth = (await response.json().catch(() => null)) as AuthConfig | null;
    if (!response.ok || !auth || !/^client_[a-zA-Z0-9]+$/.test(auth.clientId))
      throw new Error('WorkOS CLI login is not configured for this deployment.');
    const { clientId } = auth;
    async function save(tokens: CliTokens, orgId: string) {
      const value: SavedSession = {
        clientId,
        refreshToken: tokens.refresh_token,
        organizationId: orgId,
      };
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    }
    if (command === 'login') {
      const tokens = await (options.login ?? loginCli)(clientId, (url, code) => console.error(`Open ${url}\nConfirm code: ${code}`));
      if (!tokens.organization_id?.startsWith('org_'))
        throw new Error('WorkOS did not return an organization-scoped session.');
      await save(tokens, tokens.organization_id);
      return tokens.access_token;
    }
    let saved: SavedSession;
    try {
      const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const info = await handle.stat();
        if (!info.isFile() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) throw new Error('CLI session file must be private.');
        saved = JSON.parse(await handle.readFile('utf8')) as SavedSession;
      } finally { await handle.close(); }
    } catch {
      throw new Error('Run cli login first, or set CONVEX_PLATFORMS_TOKEN.');
    }
    if (
      !saved ||
      saved.clientId !== auth.clientId ||
      !saved.organizationId?.startsWith('org_') ||
      typeof saved.refreshToken !== 'string'
    )
      throw new Error('Deployment login configuration changed. Run login again.');
    try {
      const tokens = await (options.refresh ?? refreshCli)(clientId, saved.refreshToken);
      if (tokens.organization_id !== saved.organizationId) throw new Error('WorkOS returned a different organization.');
      await save(tokens, saved.organizationId);
      return tokens.access_token;
    } catch (error) {
      if (error && typeof error === 'object' && 'invalidGrant' in error && error.invalidGrant) await unlink(file);
      throw error;
    }
  } finally {
    await lock.close();
    await unlink(`${file}.lock`);
  }
}

/** Wait for a short concurrent refresh; never steal an interrupted process's lock. */
export async function acquireSessionLock(path: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await open(path, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (Date.now() >= deadline)
        throw new Error(
          'CLI session is busy. If its process was interrupted, remove its .lock file after confirming no command is running.',
          { cause: error },
        );
      await new Promise((resolve) => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))));
    }
  }
}
