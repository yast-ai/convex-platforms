import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sessionToken, acquireSessionLock } from '../src/session.js';
const fetchConfig = (async () => Response.json({ clientId: 'client_test' })) as typeof fetch;
const login = async () => ({ access_token: 'access', refresh_token: 'refresh', organization_id: 'org_test' });
describe('private rotating sessions', () => {
  test('stores only origin-scoped refresh credentials and rotates atomically', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ports-session-'));
    try {
      const options = {
        directory,
        fetch: fetchConfig,
        login,
        refresh: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          organization_id: 'org_test',
        }),
      };
      await sessionToken('https://one.convex.site', 'login', options);
      const file = (await readdir(directory)).find((f) => f.endsWith('.json'))!;
      let saved = JSON.parse(await readFile(join(directory, file), 'utf8'));
      expect(saved.accessToken).toBeUndefined();
      expect(saved.refreshToken).toBe('refresh');
      expect((await stat(join(directory, file))).mode & 0o077).toBe(0);
      expect(await sessionToken('https://one.convex.site', 'token', options)).toBe('new-access');
      saved = JSON.parse(await readFile(join(directory, file), 'utf8'));
      expect(saved.refreshToken).toBe('new-refresh');
      await expect(sessionToken('https://two.convex.site', 'token', options)).rejects.toThrow('login');
      await sessionToken('https://one.convex.site', 'logout', options);
      expect(await readdir(directory)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  test('rejects organization drift', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ports-session-'));
    try {
      const options = {
        directory,
        fetch: fetchConfig,
        login,
        refresh: async () => ({
          access_token: 'other',
          refresh_token: 'other',
          organization_id: 'org_other',
        }),
      };
      await sessionToken('https://one.convex.site', 'login', options);
      await expect(sessionToken('https://one.convex.site', 'token', options)).rejects.toThrow(
        'different organization',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  test('refuses symbolic link directory and lock stealing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ports-session-'));
    try {
      await symlink(directory, join(directory, 'link'));
      await expect(
        sessionToken('https://one.convex.site', 'logout', { directory: join(directory, 'link') }),
      ).rejects.toThrow('private');
      const path = join(directory, 'lock');
      const lock = await acquireSessionLock(path);
      try {
        await expect(acquireSessionLock(path, 10)).rejects.toThrow('busy');
      } finally {
        await lock.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
