import { mkdir, readFile, writeFile, lstat, readdir, cp } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { siteOrigin } from './transport.js';
import { projectPath } from './paths.js';
import type { Manifest } from './contract.js';
export async function generatePlugins({
  root = '.',
  name,
  siteUrl,
  description = 'Tools for this application',
  skillsDir = 'skills',
}: {
  root?: string;
  name: string;
  siteUrl: string;
  description?: string;
  skillsDir?: string;
}) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error('Use a lowercase plugin slug');
  if (!description.trim() || description.length > 1000)
    throw new Error('Provide a concise plugin description');
  const origin = siteOrigin(siteUrl);
  if (!origin.startsWith('https:')) throw new Error('Plugin bundles require a public HTTPS deployment');
  const directory = resolve(root);
  const manifest = JSON.parse(
    await readFile(await projectPath(directory, 'platforms/generated/manifest.json'), 'utf8'),
  ) as Manifest;
  if (manifest.version !== 1 || !manifest.operations.some((op) => op.platforms.includes('mcp')))
    throw new Error('Generate at least one MCP-enabled operation before packaging plugins');
  const mcpUrl = origin + '/mcp';
  const pluginRoot = join(directory, 'plugins');
  const files: Record<string, unknown> = {
    'openai/plugin.json': {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name,
      version: '0.1.0',
      description,
    },
    'openai/mcp.json': {
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: { [name]: { type: 'streamable-http', url: mcpUrl } },
    },
    'claude/.claude-plugin/plugin.json': { name, version: '0.1.0', description },
    'claude/.mcp.json': { mcpServers: { [name]: { type: 'http', url: mcpUrl } } },
  };
  // Validate destinations and curated inputs before creating any artifacts.
  const custom = await projectPath(directory, skillsDir);
  const customInfo = await lstat(custom).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (customInfo && !customInfo.isDirectory()) throw new Error('Skills must be a directory');
  if (customInfo) await rejectSymlinks(custom);
  for (const host of ['openai', 'claude']) {
    const target = await projectPath(directory, 'plugins/' + host + '/skills');
    if (
      await lstat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      })
    )
      throw new Error(`plugins/${host}/skills already exists. Review the existing bundle.`);
  }
  for (const path of Object.keys(files)) {
    const full = await projectPath(directory, 'plugins/' + path);
    if (
      await lstat(full).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      })
    )
      throw new Error(`plugins/${path} already exists. Version and edit the existing bundle.`);
  }
  for (const [path, value] of Object.entries(files)) {
    const full = join(pluginRoot, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  }
  for (const host of ['openai', 'claude']) {
    const target = join(pluginRoot, host, 'skills');
    if (customInfo?.isDirectory()) {
      await rejectSymlinks(custom);
      await cp(custom, target, { recursive: true, errorOnExist: true, force: false });
    } else {
      const targetDir = join(target, 'use-' + name);
      await mkdir(targetDir, { recursive: true });
      const tools = manifest.operations
        .filter((op) => op.platforms.includes('mcp'))
        .map((op) => `- ${op.tool}: ${op.description}`)
        .join('\n');
      await writeFile(
        join(targetDir, 'SKILL.md'),
        `---\nname: use-${name}\ndescription: ${JSON.stringify(description)}\n---\n\nUse the connected ${name} MCP tools when the user requests this application's operations.\n\n${tools}\n\nResolve available tool names from the connected server. Ask for missing operation inputs. Follow the user's authorization; do not infer permission for unrelated writes or messages. Report server errors honestly. Never request or embed API keys.\n`,
      );
    }
  }
  return { openai: join(pluginRoot, 'openai'), claude: join(pluginRoot, 'claude') };
}
async function rejectSymlinks(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Skills must not contain symbolic links');
    if (entry.isDirectory()) await rejectSymlinks(join(path, entry.name));
  }
}
