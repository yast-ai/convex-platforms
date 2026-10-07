/* eslint-disable @typescript-eslint/no-explicit-any -- optional Vite modules do not expose a stable shared type surface. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Widget } from './contract.js';

type UiConfig = { csp?: Widget['csp'] };
const cspKeys = new Set<keyof NonNullable<Widget['csp']>>([
  'connectDomains',
  'resourceDomains',
  'frameDomains',
  'baseUriDomains',
]);
function origins(values: string[] | undefined, name: string): string[] | undefined {
  if (!values) return undefined;
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string'))
    throw new Error(`${name}: CSP domains must be string arrays`);
  for (const value of values)
    if (!value.startsWith('https://') || new URL(value).origin !== value)
      throw new Error(`${name}: CSP domains must be HTTPS origins`);
  return [...new Set(values)].sort();
}

/** Bundle one MCP widget without inheriting app env or public files. Vite stays an optional build dependency. */
export async function bundleUi(root: string, uiDir: string, name: string): Promise<Widget> {
  if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) throw new Error(`${name}: ui must be a lowerCamelCase UI name`);
  const html = resolve(root, uiDir, `${name}.html`);
  const configPath = resolve(root, uiDir, `${name}.json`);
  const config: UiConfig = await readFile(configPath, 'utf8')
    .then(JSON.parse)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return {};
      throw error;
    });
  const csp: Widget['csp'] = {};
  for (const [key, values] of Object.entries(config.csp ?? {})) {
    if (!cspKeys.has(key as keyof NonNullable<Widget['csp']>))
      throw new Error(`${name}: unsupported CSP key ${key}`);
    const normalized = origins(values as string[] | undefined, name);
    if (normalized?.length) (csp as Record<string, string[]>)[key] = normalized;
  }
  let vite: any, react: any, single: any;
  try {
    [vite, react, single] = await Promise.all([
      import('vite'),
      import('@vitejs/plugin-react'),
      import('vite-plugin-singlefile'),
    ]);
  } catch (error) {
    throw new Error(
      `UI packaging needs optional build dependencies. Install vite, @vitejs/plugin-react, and vite-plugin-singlefile in the consuming project (or add them to the root package exports/dependencies): ${(error as Error).message}`,
    );
  }
  const tailwind = await import('@tailwindcss/vite').catch((error: NodeJS.ErrnoException) => {
    if (
      ['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code ?? '') &&
      error.message.includes('@tailwindcss/vite')
    )
      return undefined;
    throw error;
  });
  const result = await vite.build({
    root,
    configFile: false,
    envFile: false,
    envPrefix: '__CONVEX_PLATFORMS_NEVER_MATCH__',
    publicDir: false,
    logLevel: 'error',
    resolve: { tsconfigPaths: true },
    css: { postcss: {} },
    plugins: [react.default(), ...(tailwind ? [tailwind.default()] : []), single.viteSingleFile()],
    build: { write: false, sourcemap: false, rollupOptions: { input: html } },
  });
  const output = (
    Array.isArray(result) ? result.flatMap((item: any) => item.output) : result.output
  ) as Array<{ type: string; fileName: string; source?: unknown }>;
  const rendered = output.find((entry) => entry.type === 'asset' && entry.fileName.endsWith('.html'));
  if (!rendered || typeof rendered.source !== 'string' || output.length !== 1)
    throw new Error(`${name}: UI must bundle to exactly one self-contained HTML asset`);
  return { text: rendered.source, ...(Object.keys(csp).length ? { csp } : {}) };
}
