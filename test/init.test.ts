import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeProject } from '../src/init.js';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ports-init-'));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ dependencies: { convex: '^1.46.0' }, scripts: { dev: 'convex dev' } }),
  );
  return root;
}
describe('project initialization', () => {
  test('creates typed binding without replacing existing auth or routes', async () => {
    const root = await fixture();
    try {
      await mkdir(join(root, 'convex'));
      const auth = 'export default {providers: []};\n';
      const http = '// custom routes\n';
      await writeFile(join(root, 'convex/auth.config.ts'), auth);
      await writeFile(join(root, 'convex/http.ts'), http);
      const result = await initializeProject({ root, name: 'test-app' });
      expect(result.httpNeedsMount).toBe(true);
      expect(result.authNeedsMerge).toBe(true);
      expect(await readFile(join(root, 'convex/auth.config.ts'), 'utf8')).toBe(auth);
      expect(await readFile(join(root, 'convex/http.ts'), 'utf8')).toBe(http);
      const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      expect(pkg.scripts.dev).toBe('convex dev');
      expect(pkg.scripts['ports:generate']).toContain('test-app');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test('detects conflicts before writing', async () => {
    const root = await fixture();
    try {
      await mkdir(join(root, 'convex'));
      await writeFile(join(root, 'convex/platforms.ts'), 'existing');
      await expect(initializeProject({ root })).rejects.toThrow('already exists');
      expect(await Bun.file(join(root, 'convex/ports.ts')).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('rejects symlinked parent directories before any writes', async () => {
  const root = await fixture();
  const outside = await fixture();
  try {
    const { symlink } = await import('node:fs/promises');
    await symlink(outside, join(root, 'convex'));
    await expect(initializeProject({ root })).rejects.toThrow('symbolic-link');
    expect(await Bun.file(join(outside, 'platforms.ts')).exists()).toBe(false);
    expect(await Bun.file(join(root, 'platforms/SETUP.md')).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
