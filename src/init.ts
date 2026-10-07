import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { projectPath } from './paths.js';
import type { Manifest } from './contract.js';

export async function initializeProject({ root = '.', name = 'my-app' }: { root?: string; name?: string }) {
  const directory = resolve(root);
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error('Use a lowercase application slug');
  const packagePath = await projectPath(directory, 'package.json');
  await projectPath(directory, 'convex/auth.config.ts');
  await projectPath(directory, 'convex/http.ts');
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
    'convex/platforms.ts': `import { v, type Infer } from 'convex/values';
import { createPlatforms } from '@disposabl/convex-platforms/platforms';
import type { DataModel } from './_generated/dataModel';

const role = v.union(v.literal('admin'), v.literal('member'));
const platforms = createPlatforms<DataModel, Infer<typeof role>>({
  role, roles: ['admin', 'member'], adminRoles: ['admin'], defaultRole: 'member',
  getServerConfig: () => ({
    clientId: process.env.WORKOS_CLIENT_ID ?? '', apiKey: process.env.WORKOS_API_KEY ?? '',
    authkitUrl: process.env.WORKOS_AUTHKIT_URL ?? '', siteUrl: process.env.CONVEX_SITE_URL ?? '',
  }),
  getSessionIssuers: () => ['https://api.workos.com/', \`https://api.workos.com/user_management/\${process.env.WORKOS_CLIENT_ID}\`],
});
export const { internalQuery, internalMutation, internalAction, registerRoutes } = platforms;
export const identityFields = platforms.validators.identityFields;
// Optional: export const { getAccount, listMembers } = platforms.functions;
// Public aliases require a trusted resolveIdentity callback in the configuration above.
`,
    'platforms/generated/manifest.json': JSON.stringify(empty, null, 2) + '\n',
    'platforms/SETUP.md': `# ${name} setup

One convex/platforms.ts integration supplies native internal builders, optional WorkOS account/team functions and HTTP registration. Custom business operations import the builders and identityFields from that file. Enforce resource ownership inside each function.

If convex/http.ts already exists, preserve its router and add:

\`\`\`ts
import type { Manifest } from '@disposabl/convex-platforms';
import manifest from '../platforms/generated/manifest.json';
import { registerRoutes } from './platforms';
registerRoutes(http, manifest as Manifest);
\`\`\`

Before deploying, set WORKOS_CLIENT_ID, WORKOS_API_KEY and WORKOS_AUTHKIT_URL on the selected Convex deployment. WORKOS_AUTHKIT_URL must be that environment's trusted public HTTPS AuthKit origin with no path. Convex supplies CONVEX_SITE_URL. Never expose credentials through VITE_ variables. Existing auth.config.ts is preserved; merge getWorkOSAuthProviders from @disposabl/convex-platforms/oauth with your current providers.

Match the role validator, roles, adminRoles and defaultRole to your WorkOS environment. The generated defaults use admin/member. No builtin is exported by default. Destructure only the operations you want from platforms.functions. Optional platforms.publicFunctions aliases deny every call until you configure resolveIdentity to resolve trusted orgId, userId and role from ctx.auth. Reject Connect tokens and client-supplied identity in that callback. Keep custom public wrappers if your app already has them.

Add webhook configuration to the same createPlatforms call if you need signed event synchronization or personal organization provisioning. See the package WorkOS guide for the optional policy and callbacks.

Enable WorkOS Connect CIMD and register the exact deployment /mcp resource audience. Generation cannot change dashboard settings. Use bun run ports:generate before convex dev or deployment. The integration imports no generated manifest, so first generation works without generated files or credentials. Only http.ts imports the manifest, and discovery skips that file.

Keep platforms/generated out of source control and generate first in CI. Generated SDKs and plugin bundles are application artifacts with their own names/releases.
`,
  };
  const authPath = resolve(directory, 'convex/auth.config.ts');
  if (!(await exists(authPath)))
    files['convex/auth.config.ts'] =
      `import { getWorkOSAuthProviders } from '@disposabl/convex-platforms/oauth';\nexport default { providers: getWorkOSAuthProviders({ clientId: process.env.WORKOS_CLIENT_ID ?? '', authkitUrl: process.env.WORKOS_AUTHKIT_URL, siteUrl: process.env.CONVEX_SITE_URL ?? '' }) };\n`;
  const httpPath = resolve(directory, 'convex/http.ts');
  const http = await readFile(httpPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (http === null)
    files['convex/http.ts'] =
      `import { httpRouter } from 'convex/server';\nimport type { Manifest } from '@disposabl/convex-platforms';\nimport manifest from '../platforms/generated/manifest.json';\nimport { registerRoutes } from './platforms';\nconst http = httpRouter();\nregisterRoutes(http, manifest as Manifest);\nexport default http;\n`;
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
    const full = await projectPath(directory, path);
    const info = await lstat(full).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (info?.isSymbolicLink()) throw new Error(`Refusing symbolic-link destination: ${path}`);
    if (info && (await readFile(full, 'utf8')) !== content)
      throw new Error(`${path} already exists. Review it before initializing.`);
  }
  for (const [path, content] of Object.entries(files)) {
    const full = await projectPath(directory, path);
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
