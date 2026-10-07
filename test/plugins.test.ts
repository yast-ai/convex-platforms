import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generatePlugins } from '../src/plugins.js';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'platform-plugins-'));
  await mkdir(join(root, 'platforms/generated'), { recursive: true });
  await writeFile(
    join(root, 'platforms/generated/manifest.json'),
    JSON.stringify({
      version: 1,
      operations: [{ tool: 'todos_list', description: 'List todos', platforms: ['mcp'] }],
    }),
  );
  return root;
}
test('creates host-specific project bundles and preserves curated skills', async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, 'skills/todos'), { recursive: true });
    await writeFile(join(root, 'skills/todos/SKILL.md'), 'Curated instructions');
    const result = await generatePlugins({ root, name: 'todos-app', siteUrl: 'https://example.com' });
    const openai = JSON.parse(await readFile(join(result.openai, 'mcp.json'), 'utf8'));
    const claude = JSON.parse(await readFile(join(result.claude, '.mcp.json'), 'utf8'));
    expect(openai.mcpServers['todos-app']).toEqual({
      type: 'streamable-http',
      url: 'https://example.com/mcp',
    });
    expect(claude.mcpServers['todos-app'].type).toBe('http');
    expect(await readFile(join(result.openai, 'skills/todos/SKILL.md'), 'utf8')).toBe('Curated instructions');
    await expect(
      generatePlugins({ root, name: 'todos-app', siteUrl: 'https://example.com' }),
    ).rejects.toThrow('already exists');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('rejects external skills and symlinked destinations before creating manifests', async () => {
  const root = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'plugin-external-'));
  try {
    await expect(
      generatePlugins({ root, name: 'todos', siteUrl: 'https://example.com', skillsDir: outside }),
    ).rejects.toThrow('inside');
    await mkdir(join(root, 'plugins'));
    await symlink(outside, join(root, 'plugins/openai'));
    await expect(generatePlugins({ root, name: 'todos', siteUrl: 'https://example.com' })).rejects.toThrow(
      'symbolic-link',
    );
    expect(await Bun.file(join(outside, 'plugin.json')).exists()).toBe(false);
    expect(await Bun.file(join(root, 'plugins/claude/.mcp.json')).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
test('rejects nested skill symlinks before writing either host', async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, 'skills'));
    await symlink('/etc/passwd', join(root, 'skills/private'));
    await expect(generatePlugins({ root, name: 'todos', siteUrl: 'https://example.com' })).rejects.toThrow(
      'symbolic links',
    );
    expect(await Bun.file(join(root, 'plugins/openai/plugin.json')).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
