import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { generatePlatforms } from '../src/generate.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(source: string) {
  const root = await mkdtemp(join(tmpdir(), 'convex-platforms-'));
  roots.push(root);
  await mkdir(join(root, 'convex/todos'), { recursive: true });
  await symlink(resolve(import.meta.dirname, '../node_modules'), join(root, 'node_modules'));
  await Bun.write(join(root, 'convex/todos/internal.ts'), source);
  return root;
}
const definition = `import { v } from 'convex/values';
const key = Symbol.for('yast.convex-platforms.validators');
export const listTodos = Object.assign({isInternal:true,isQuery:true,platforms:{api:true,'sdk-typescript':true,'sdk-python':true},description:'List todos'}, {[key]:{args:{orgId:v.string(),userId:v.string(),role:v.union(v.literal('admin'),v.literal('member')),done:v.optional(v.boolean())},returns:v.array(v.object({id:v.string(),done:v.boolean()}))}});`;

describe('generatePlatforms', () => {
  test('writes a flat external contract and executable SDK sources', async () => {
    const root = await fixture(definition);
    const manifest = await generatePlatforms({ root, name: 'Example' });
    expect(manifest.operations).toHaveLength(1);
    expect(manifest.operations[0]?.path).toBe('/api/v1/todos/list');
    expect(manifest.operations[0]?.inputSchema.properties).not.toHaveProperty('orgId');
    expect(await readFile(join(root, 'platforms/generated/sdk-typescript.ts'), 'utf8')).toContain(
      'export class Client',
    );
    const python = await readFile(join(root, 'platforms/generated/sdk-python.py'), 'utf8');
    expect(python).toContain('class Client');
    const compilation = Bun.spawnSync(
      ['python3', '-m', 'py_compile', join(root, 'platforms/generated/sdk-python.py')],
      { env: { ...process.env, PYTHONPYCACHEPREFIX: join(root, 'pycache') } },
    );
    expect(compilation.stderr.toString()).toBe('');
    expect(compilation.exitCode).toBe(0);
    const first = await readFile(join(root, 'platforms/generated/manifest.json'), 'utf8');
    await generatePlatforms({ root, name: 'Example' });
    expect(await readFile(join(root, 'platforms/generated/manifest.json'), 'utf8')).toBe(first);
    await expect(generatePlatforms({ root, name: 'Example', check: true })).resolves.toMatchObject({
      version: 1,
    });
    await writeFile(join(root, 'platforms/generated/manifest.json'), '{}');
    await expect(generatePlatforms({ root, name: 'Example', check: true })).rejects.toThrow('stale');
  });

  test('rejects public functions and duplicate generated routes', async () => {
    const root = await fixture(definition.replace('isInternal:true', 'isInternal:false'));
    await expect(generatePlatforms({ root })).rejects.toThrow('only native internal');
  });
});
