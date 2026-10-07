import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

type PackedPackage = { filename: string };

const packageRoot = process.cwd();
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'convex-platforms-package-'));
const npmCacheDirectory = join(temporaryDirectory, 'npm-cache');
const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
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

  for (const [entrypoint, value] of Object.entries(packageJson.exports ?? {})) {
    const exportValue = value as { import?: string; types?: string };
    for (const target of [exportValue.import, exportValue.types].filter((item): item is string =>
      Boolean(item),
    )) {
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
    ],
    consumer,
  );
  run(
    'node',
    ['--input-type=module', '--eval', `await import(${JSON.stringify(packageJson.name)});`],
    consumer,
  );
  await Bun.write(
    join(consumer, 'index.ts'),
    `import type { Manifest } from ${JSON.stringify(packageJson.name)};\nconst manifest: Manifest | undefined = undefined;\nvoid manifest;\n`,
  );
  run(
    join(consumer, 'node_modules/.bin/tsc'),
    ['--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'index.ts'],
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
