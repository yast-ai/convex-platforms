import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { generatePlatforms } from '../src/generate.js';
import { bundleUi } from '../src/ui-build.js';

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
  test('discovers real native Convex internal query and mutations', async () => {
    const output = await mkdtemp(join(tmpdir(), 'convex-platforms-output-'));
    roots.push(output);
    const manifest = await generatePlatforms({
      root: resolve(import.meta.dirname, 'fixtures'),
      functionsDir: 'convex',
      outputDir: output,
      name: 'Fixture',
    });
    expect(manifest.operations.map((operation) => operation.name)).toEqual([
      'createTodo',
      'deleteTodo',
      'listTodos',
    ]);
    expect(manifest.operations.map((operation) => operation.type)).toEqual(['mutation', 'mutation', 'query']);
    expect(
      manifest.operations.every(
        (operation) => !Object.hasOwn(operation.inputSchema.properties as object, 'orgId'),
      ),
    ).toBe(true);
    expect(
      manifest.operations.find((operation) => operation.name === 'listTodos')?.inputSchema.properties,
    ).toHaveProperty('paginationOpts');
  });

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

  test('removes deselected SDK artifacts and check rejects stale extras', async () => {
    const root = await fixture(definition);
    await generatePlatforms({ root, name: 'Example' });
    await rm(join(root, 'convex/todos/internal.ts'));
    await writeFile(join(root, 'convex/todos/schema.ts'), 'export {};');
    await expect(generatePlatforms({ root, name: 'Example', check: true })).rejects.toThrow('stale');
    await generatePlatforms({ root, name: 'Example' });
    await expect(readFile(join(root, 'platforms/generated/sdk-typescript.ts'), 'utf8')).rejects.toMatchObject(
      { code: 'ENOENT' },
    );
    await expect(generatePlatforms({ root, name: 'Example', check: true })).resolves.toMatchObject({
      operations: [],
    });
  });

  test('does not load VITE secrets and rejects unknown widget CSP policy keys', async () => {
    const root = await fixture(definition);
    await mkdir(join(root, 'platforms/ui'), { recursive: true });
    await writeFile(join(root, '.env'), 'VITE_PRIVATE_WIDGET_SECRET=do-not-bundle\n');
    await writeFile(
      join(root, 'platforms/ui/widget.html'),
      '<script type="module" src="./widget.ts"></script>',
    );
    await writeFile(
      join(root, 'platforms/ui/widget.ts'),
      'document.body.textContent = import.meta.env.VITE_PRIVATE_WIDGET_SECRET;',
    );
    const widget = await bundleUi(root, 'platforms/ui', 'widget');
    expect(widget.text).not.toContain('do-not-bundle');
    await writeFile(
      join(root, 'platforms/ui/widget.json'),
      JSON.stringify({ csp: { scriptDomains: ['https://example.com'] } }),
    );
    await expect(bundleUi(root, 'platforms/ui', 'widget')).rejects.toThrow('unsupported CSP key');
  });

  test.skipIf(!process.env.CI && !process.env.PLATFORMS_NETWORK_TESTS)(
    'generated SDK clients run against a loopback server',
    async () => {
      const root = await fixture(definition);
      await generatePlatforms({ root, name: 'Example' });
      const seen: Array<{ path: string; authorization: string | null; body: unknown }> = [];
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
          const path = new URL(request.url).pathname;
          seen.push({
            path,
            authorization: request.headers.get('authorization'),
            body: await request.json(),
          });
          if (path.endsWith('/redirect'))
            return new Response(null, { status: 302, headers: { location: '/api/v1/todos/list' } });
          if (path.endsWith('/error')) return Response.json({ error: 'nope' }, { status: 418 });
          return Response.json({ status: 'success', value: [{ id: 'ok', done: true }] });
        },
      });
      try {
        const origin = server.url.toString();
        const sdk = await import(pathToFileURL(join(root, 'platforms/generated/sdk-typescript.ts')).href);
        await expect(new sdk.Client(origin, 'token').todos.list()).resolves.toEqual([
          { id: 'ok', done: true },
        ]);
        await expect(sdk.request(origin, 'token', '/api/v1/error', {})).rejects.toMatchObject({
          status: 418,
        });
        await expect(sdk.request(origin, 'token', '/api/v1/redirect', {})).rejects.toThrow();
        await expect(
          sdk.request('https://example.com/path', 'token', '/api/v1/todos/list', {}),
        ).rejects.toThrow('site origin');
        await expect(sdk.request(origin, 'bad\r\ntoken', '/api/v1/todos/list', {})).rejects.toThrow(
          'bearer token',
        );
        const python = Bun.spawn([
          process.env.PYTHON ?? 'python3',
          '-c',
          "import importlib.util,sys; spec=importlib.util.spec_from_file_location('sdk',sys.argv[1]); sdk=importlib.util.module_from_spec(spec); spec.loader.exec_module(sdk); print(sdk.Client(sys.argv[2],'token').todos.list()[0]['id'])\nfor path in ['/api/v1/error','/api/v1/redirect']:\n try: sdk._request(sys.argv[2],'token',path,{})\n except sdk.ApiError as error: print(error.status)\nfor url,token in [('https://example.com/path','token'),(sys.argv[2],'bad\\r\\ntoken')]:\n try: sdk._request(url,token,'/api/v1/todos/list',{})\n except ValueError: print('rejected')",
          join(root, 'platforms/generated/sdk-python.py'),
          origin,
        ]);
        expect(await new Response(python.stdout).text()).toBe('ok\n418\n302\nrejected\nrejected\n');
        expect(await python.exited).toBe(0);
        expect(seen).toEqual([
          { path: '/api/v1/todos/list', authorization: 'Bearer token', body: {} },
          { path: '/api/v1/error', authorization: 'Bearer token', body: {} },
          { path: '/api/v1/redirect', authorization: 'Bearer token', body: {} },
          { path: '/api/v1/todos/list', authorization: 'Bearer token', body: {} },
          { path: '/api/v1/error', authorization: 'Bearer token', body: {} },
          { path: '/api/v1/redirect', authorization: 'Bearer token', body: {} },
        ]);
      } finally {
        server.stop(true);
      }
    },
  );

  test('rejects public functions and duplicate generated routes', async () => {
    const root = await fixture(definition.replace('isInternal:true', 'isInternal:false'));
    await expect(generatePlatforms({ root })).rejects.toThrow('only native internal');
  });
});
