import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

type PackedPackage = { filename: string };
type ExportTarget = string | { [condition: string]: ExportTarget };

const packageRoot = process.cwd();
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'convex-platforms-package-'));
const npmCacheDirectory = join(temporaryDirectory, 'npm-cache');
const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
  bin?: Record<string, string>;
  exports?: ExportTarget;
  name: string;
};

function run(command: string, args: string[], cwd = packageRoot): string {
  const result = Bun.spawnSync([command, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isAllowedPackageFile(path: string): boolean {
  return (
    path === 'package/package.json' ||
    path === 'package/README.md' ||
    path === 'package/LICENSE' ||
    path === 'package/NOTICE' ||
    path.startsWith('package/dist/') ||
    path.startsWith('package/templates/') ||
    path.startsWith('package/docs/')
  );
}

function exportTargets(value: unknown, entrypoint: string): string[] {
  if (typeof value === 'string') return [value];
  assert(
    value && typeof value === 'object' && !Array.isArray(value),
    `Export ${entrypoint} must be a string or condition map.`,
  );
  const targets = Object.entries(value as Record<string, unknown>).flatMap(([condition, target]) =>
    exportTargets(target, `${entrypoint} (${condition})`),
  );
  assert(targets.length > 0, `Export ${entrypoint} must contain at least one target.`);
  return targets;
}

function packageSpecifier(name: string, entrypoint: string): string {
  return entrypoint === '.' ? name : `${name}/${entrypoint.replace(/^\.\//, '')}`;
}

try {
  await mkdir(npmCacheDirectory, { recursive: true });
  const packed = JSON.parse(
    run('npm', ['pack', '--json', '--pack-destination', temporaryDirectory, '--cache', npmCacheDirectory]),
  ) as PackedPackage[];
  assert(packed.length === 1, 'npm pack must produce exactly one tarball.');
  const tarball = join(temporaryDirectory, packed[0].filename);
  const listedFiles = run('tar', ['-tzf', tarball]).trim().split('\n').filter(Boolean);
  assert(
    listedFiles.every(isAllowedPackageFile),
    `Package contains files outside the allowlist:\n${listedFiles.filter((file) => !isAllowedPackageFile(file)).join('\n')}`,
  );
  assert(
    listedFiles.every((file) => !/(^|\/)(?:\.env|node_modules|\.git)(?:\/|$)/.test(file)),
    'Package includes a private environment, Git, or dependency path.',
  );

  const packageExports =
    typeof packageJson.exports === 'string' ? { '.': packageJson.exports } : packageJson.exports;
  assert(
    packageExports && typeof packageExports === 'object' && !Array.isArray(packageExports),
    'Package exports must be a string or export map.',
  );
  assert(Object.keys(packageExports).length > 0, 'Package must declare at least one export.');
  for (const [entrypoint, value] of Object.entries(packageExports)) {
    for (const target of exportTargets(value as ExportTarget, entrypoint)) {
      assert(target.startsWith('./'), `Export ${entrypoint} must use a package-relative target.`);
      assert(
        listedFiles.includes(`package/${target.replace(/^\.\//, '')}`),
        `Export ${entrypoint} points to a missing packed artifact: ${target}`,
      );
    }
  }
  for (const [name, target] of Object.entries(packageJson.bin ?? {})) {
    assert(
      listedFiles.includes(`package/${target.replace(/^\.\//, '')}`),
      `CLI ${name} points to a missing packed artifact: ${target}`,
    );
  }

  run('tar', ['-xzf', tarball, '-C', temporaryDirectory]);
  const packageDirectory = join(temporaryDirectory, 'package');
  const runtimeFiles: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (/\.(?:[cm]?js|d\.ts)$/.test(entry.name)) runtimeFiles.push(file);
    }
  }
  await walk(packageDirectory);
  const prohibited =
    /(?:from\s+['"](?:\.\.\/src|\/private\/|file:)|require\(['"](?:\.\.\/src|\/private\/|file:)|\b(?:NPM_TOKEN|GITHUB_TOKEN|ghp_[A-Za-z0-9_]+|npm_[A-Za-z0-9_]+|AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)\b)/;
  for (const file of runtimeFiles) {
    assert(
      !prohibited.test(await readFile(file, 'utf8')),
      `Packed artifact contains a private import or credential marker: ${relative(packageDirectory, file)}`,
    );
  }

  const consumer = join(temporaryDirectory, 'consumer');
  await mkdir(consumer, { recursive: true });
  await Bun.write(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-package-lock',
      '--omit=dev',
      '--cache',
      npmCacheDirectory,
      tarball,
      'convex@^1.46.0',
      'react@^19.0.0',
      'react-dom@^19.0.0',
      'typescript@^5.9.0',
      '@types/node@^24.0.0',
    ],
    consumer,
  );
  run(
    'node',
    [
      '--input-type=module',
      '--eval',
      `await Promise.all(${JSON.stringify(Object.keys(packageExports).map((entrypoint) => packageSpecifier(packageJson.name, entrypoint)))}.map((entrypoint) => import(entrypoint)));`,
    ],
    consumer,
  );
  const installedBin = join(consumer, 'node_modules/.bin/convex-platforms');
  assert(
    run(installedBin, ['--help'], consumer).includes('Usage: convex-platforms'),
    'Installed executable is missing a working shebang',
  );
  assert(
    run('bun', [installedBin, '--help'], consumer).includes('Usage: convex-platforms'),
    'Installed Bun CLI did not execute',
  );
  assert(
    run('node', [installedBin, '--help'], consumer).includes('Usage: convex-platforms'),
    'Installed Node CLI did not execute',
  );
  await Bun.write(
    join(consumer, 'index.ts'),
    `import { v } from 'convex/values';
import type { GenericDataModel } from 'convex/server';
import { createPlatformFunctions, identityFields } from ${JSON.stringify(packageSpecifier(packageJson.name, './functions'))};
import type { Manifest } from ${JSON.stringify(packageJson.name)};
const builders = createPlatformFunctions<GenericDataModel>();
builders.internalMutation({ args: { ...identityFields, text: v.string() }, returns: v.string(), handler: async (_ctx, args) => args.text });
const manifest: Manifest | undefined = undefined;
void manifest;
`,
  );
  run(
    join(consumer, 'node_modules/.bin/tsc'),
    ['--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'index.ts'],
    consumer,
  );

  await mkdir(join(consumer, 'convex/todos'), { recursive: true });
  await Bun.write(
    join(consumer, 'convex/todos/internal.ts'),
    `import { v } from 'convex/values';
import type { GenericDataModel } from 'convex/server';
import { createPlatformFunctions, identityFields } from ${JSON.stringify(packageSpecifier(packageJson.name, './functions'))};
const { internalQuery } = createPlatformFunctions<GenericDataModel>();
export const listTodos = internalQuery({
  platforms: { api: true, 'sdk-typescript': true, 'sdk-python': true },
  description: 'List todos',
  args: { ...identityFields },
  returns: v.array(v.string()),
  handler: async () => [],
});
`,
  );
  run(
    'bun',
    [
      '--eval',
      `import { generatePlatforms } from ${JSON.stringify(packageSpecifier(packageJson.name, './generate'))};
const manifest = await generatePlatforms({ root: process.cwd(), outputDir: 'generated' });
if (manifest.operations.length !== 1 || manifest.operations[0]?.name !== 'listTodos') {
  throw new Error('Packed generator did not discover the native internal function.');
}`,
    ],
    consumer,
  );
  const generatedTypeScript = join(consumer, 'generated/sdk-typescript.ts');
  const generatedPython = join(consumer, 'generated/sdk-python.py');
  assert(
    await Bun.file(generatedTypeScript).exists(),
    'Packed generator did not write the TypeScript SDK template.',
  );
  assert(await Bun.file(generatedPython).exists(), 'Packed generator did not write the Python SDK template.');
  run(
    join(consumer, 'node_modules/.bin/tsc'),
    [
      '--noEmit',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2022',
      generatedTypeScript,
    ],
    consumer,
  );
  run('python3', ['-m', 'py_compile', generatedPython], consumer);

  run(installedBin, ['init', '--name', 'packed-consumer'], consumer);
  await mkdir(join(consumer, 'convex/_generated'), { recursive: true });
  await Bun.write(
    join(consumer, 'convex/_generated/dataModel.d.ts'),
    "export type { GenericDataModel as DataModel } from 'convex/server';\n",
  );
  run(
    join(consumer, 'node_modules/.bin/tsc'),
    [
      '--noEmit',
      '--module',
      'ESNext',
      '--moduleResolution',
      'Bundler',
      '--target',
      'ES2022',
      '--resolveJsonModule',
      'convex/ports.ts',
      'convex/platforms.ts',
      'convex/http.ts',
      'convex/auth.config.ts',
    ],
    consumer,
  );

  const pythonFiles = listedFiles
    .filter((file) => file.endsWith('.py'))
    .map((file) => join(temporaryDirectory, file));
  if (pythonFiles.length > 0) run('python3', ['-m', 'compileall', '-q', ...pythonFiles]);
  console.log(
    `Verified ${packed[0].filename}: whitelist, exports, private-import scan, Node import, TypeScript declarations${pythonFiles.length > 0 ? ', and Python syntax' : ''}.`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
