import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { Manifest } from './contract.js';

export async function initializeProject({ root = '.', name = 'my-app' }: { root?: string; name?: string }) {
  const directory = resolve(root);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error('Use a lowercase application slug');
  const packagePath = resolve(directory, 'package.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as {
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  if (!pkg.dependencies?.convex)
    throw new Error('Initialize Convex first. See https://docs.convex.dev/quickstarts');
  const empty: Manifest = {
    version: 1,
    name,
    operations: [],
    widgets: {},
    openapi: { openapi: '3.1.0', info: { title: name, version: '1.0.0' }, paths: {} },
  };
  const files: Record<string, string> = {
    'convex/platforms.ts': `import { createPlatformFunctions, identityFields } from '@yast-ai/convex-platforms/functions';\nimport type { DataModel } from './_generated/dataModel';\nexport const { internalQuery, internalMutation, internalAction } = createPlatformFunctions<DataModel>();\nexport { identityFields };\n`,
    'convex/ports.ts': `import { createPlatformServer } from '@yast-ai/convex-platforms/server';\nimport manifest from '../platforms/generated/manifest.json';\nexport const platforms = createPlatformServer({\n  manifest,\n  workos: {\n    clientId: process.env.WORKOS_CLIENT_ID ?? '',\n    apiKey: process.env.WORKOS_API_KEY ?? '',\n    authkitUrl: process.env.WORKOS_AUTHKIT_URL ?? '',\n    siteUrl: process.env.CONVEX_SITE_URL ?? '',\n  },\n});\n`,
    'platforms/generated/manifest.json': JSON.stringify(empty, null, 2) + '\n',
    'platforms/SETUP.md': `# ${name} setup\n\nUse the internal builders exported from convex/platforms.ts for selected operations. Include flat identityFields in args and enforce resource ownership inside each function.\n\nAdd these two lines to convex/http.ts if they were not added automatically:\n\n\`\`\`ts\nimport { platforms } from './ports';\nplatforms.registerRoutes(http);\n\`\`\`\n\nSet WorkOS environment variables on the Convex deployment. Never put server keys in VITE_ variables. Configure existing auth.config.ts with getWorkOSAuthProviders from @yast-ai/convex-platforms/oauth, preserving your other providers. See the package onboarding guide before changing providers.\n\nEnable WorkOS Connect CIMD and register the exact deployment /mcp resource audience. Generation cannot enable dashboard settings. Use bun run ports:generate before convex dev or deployment.\n\nThe generated manifest stays in platforms/generated. Generate first in CI. Add that directory to .gitignore once your generation step is wired.\n\nGenerated SDKs and plugin bundles are application artifacts with their own names/releases; Convex Platforms is the shared runtime/tooling package.\n`,
  };
  const authPath = resolve(directory, 'convex/auth.config.ts');
  if (!(await exists(authPath)))
    files['convex/auth.config.ts'] =
      `import { getWorkOSAuthProviders } from '@yast-ai/convex-platforms/oauth';\nexport default { providers: getWorkOSAuthProviders({ clientId: process.env.WORKOS_CLIENT_ID ?? '', authkitUrl: process.env.WORKOS_AUTHKIT_URL, siteUrl: process.env.CONVEX_SITE_URL ?? '' }) };\n`;
  const httpPath = resolve(directory, 'convex/http.ts');
  const http = await readFile(httpPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (http === null)
    files['convex/http.ts'] =
      `import { httpRouter } from 'convex/server';\nimport { platforms } from './ports';\nconst http = httpRouter();\nplatforms.registerRoutes(http);\nexport default http;\n`;
  const updates = {
    ...pkg.scripts,
    'ports:generate': `convex-platforms generate --name ${name}`,
    'ports:check': `convex-platforms generate --name ${name} --check`,
  };
  for (const key of ['ports:generate', 'ports:check'] as const)
    if (pkg.scripts?.[key] && pkg.scripts[key] !== updates[key])
      throw new Error(`Existing script ${key} differs; refusing to overwrite it`);
  // Check every new destination before writing anything. Existing application wiring is never overwritten.
  for (const [path, content] of Object.entries(files)) {
    const full = resolve(directory, path);
    const info = await lstat(full).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info?.isSymbolicLink()) throw new Error(`Refusing symbolic-link destination: ${path}`);
    if (info && (await readFile(full, 'utf8')) !== content)
      throw new Error(`${path} already exists. Review it before initializing.`);
  }
  for (const [path, content] of Object.entries(files)) {
    const full = resolve(directory, path);
    await mkdir(dirname(full), { recursive: true });
    if (!(await exists(full))) await writeFile(full, content, { flag: 'wx' });
  }
  await writeFile(packagePath, JSON.stringify({ ...pkg, scripts: updates }, null, 2) + '\n');
  return {
    root: directory,
    files: Object.keys(files),
    httpNeedsMount: http !== null,
    authNeedsMerge: (await exists(authPath)) && !files['convex/auth.config.ts'],
  };
}
async function exists(path: string) {
  return !!(await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }));
}
