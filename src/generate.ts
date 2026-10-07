/* eslint-disable @typescript-eslint/no-explicit-any -- Convex validator internals are intentionally opaque at this boundary. */
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { v } from 'convex/values';
import { convexToZod } from 'convex-helpers/server/zod4';
import * as z from 'zod';
import type { JsonSchema, Manifest, Operation, Platform, Platforms, Widget } from './contract.js';
import { validatorMetadata } from './functions.js';
import { generateClients } from './clients.js';
import { bundleUi } from './ui-build.js';

const platformNames: Platform[] = ['api', 'mcp', 'cli', 'sdk-typescript', 'sdk-python'];
const identity = ['orgId', 'userId', 'role'];
const reserved = new Set(['constructor', 'prototype', '__proto__']);
let discoveryVersion = 0;
const snake = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const label = (value: string) =>
  value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (x) => x.toUpperCase());

export type GeneratePlatformsOptions = {
  root?: string;
  functionsDir?: string;
  outputDir?: string;
  name?: string;
  check?: boolean;
  uiDir?: string;
};

async function files(root: string, directory: string): Promise<string[]> {
  const absolute = resolve(root, directory);
  const result: string[] = [];
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) {
        if (!['_generated', 'node_modules'].includes(entry.name)) await walk(next);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts'))
        result.push(next);
    }
  }
  await walk(absolute).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  return result.sort();
}
function strings(validator: any): boolean {
  return (
    validator?.kind === 'string' ||
    (validator?.kind === 'literal' && typeof validator.value === 'string') ||
    (validator?.kind === 'union' && validator.members?.every(strings))
  );
}
function schema(validator: any, where: string): JsonSchema {
  try {
    return z.toJSONSchema(convexToZod(validator), {
      target: 'draft-2020-12',
      io: 'output',
      unrepresentable: ({ zodSchema }: any) =>
        zodSchema instanceof z.ZodCustom ? { type: 'string' } : 'throw',
      override: ({ zodSchema, jsonSchema }: any) => {
        if (zodSchema instanceof z.ZodRecord) delete jsonSchema.required;
      },
    }) as JsonSchema;
  } catch (error) {
    throw new Error(`${where}: validator cannot be represented as JSON Schema: ${(error as Error).message}`);
  }
}
function selected(value: unknown, where: string): Platform[] {
  if (value === true) return [...platformNames];
  if (
    value === false ||
    value === undefined ||
    (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0)
  )
    return [];
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.entries(value as object).some(
      ([key, enabled]) => !platformNames.includes(key as Platform) || typeof enabled !== 'boolean',
    )
  )
    throw new Error(`${where}: invalid platforms selection`);
  return platformNames.filter((platform) => (value as Partial<Record<Platform, boolean>>)[platform] === true);
}
function operationName(path: string, functionsRoot: string, name: string, where: string, override: unknown) {
  const file = relative(functionsRoot, path)
    .replaceAll(sep, '/')
    .replace(/\.ts$/, '')
    .replace(/\/(internal|actions|index)$/, '');
  if (
    override !== undefined &&
    (!Array.isArray(override) ||
      !override.length ||
      override.some((part: unknown) => typeof part !== 'string'))
  )
    throw new Error(`${where}: resource must be a nonempty array of lowerCamelCase segments`);
  const resource: string[] =
    override === undefined ? file.split('/').filter(Boolean) : [...(override as string[])];
  if (!resource.length || resource.some((part) => !/^[a-z][a-zA-Z0-9]*$/.test(part) || reserved.has(part)))
    throw new Error(`${where}: resource segments must be lowerCamelCase and non-reserved`);
  const verb = name.match(/^[a-z]+(?=[A-Z])/)?.[0];
  const last = resource.at(-1)!;
  const singular = last.endsWith('ies') ? `${last.slice(0, -3)}y` : last.replace(/s$/, '');
  const suffix = [last, singular]
    .map((value) => value[0]!.toUpperCase() + value.slice(1))
    .find((value) => name.slice(verb?.length).startsWith(value));
  if (!/^[a-z][a-zA-Z0-9]*$/.test(name) || !verb || !suffix)
    throw new Error(`${where}: function must be a lowerCamelCase verbResource name matching its resource`);
  const action = verb + name.slice(verb.length + suffix.length);
  return {
    resource,
    action,
    tool: [...resource, action].map(snake).join('_'),
    path: `/api/v1/${[...resource, action].join('/')}`,
  };
}
function openapi(operations: Operation[], name: string): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: `${name} API`, version: '1.0.0' },
    servers: [{ url: '/' }],
    security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    paths: Object.fromEntries(
      operations
        .filter((operation) => operation.platforms.includes('api'))
        .map((operation) => [
          operation.path,
          {
            post: {
              operationId: operation.name,
              summary: operation.description,
              tags: [label(operation.resource.join(' / '))],
              requestBody: {
                required: true,
                content: { 'application/json': { schema: operation.inputSchema } },
              },
              responses: {
                200: {
                  description: 'Success',
                  content: {
                    'application/json': {
                      schema: {
                        type: 'object',
                        properties: { status: { const: 'success' }, value: operation.outputSchema },
                        required: ['status', 'value'],
                        additionalProperties: false,
                      },
                    },
                  },
                },
                400: { description: 'Invalid arguments' },
                401: { description: 'Authentication required' },
                403: { description: 'Access denied' },
                404: { description: 'Resource not found' },
                500: { description: 'Request failed' },
              },
            },
          },
        ]),
    ),
  };
}
const generatedNames = new Set([
  'manifest.json',
  'openapi.json',
  'sdk-typescript.ts',
  'sdk-typescript.package.json',
  'sdk-python.py',
  'sdk-python.package.json',
]);
async function atomically(root: string, outputDir: string, outputs: Record<string, string>, check: boolean) {
  for (const [file, content] of Object.entries(outputs)) {
    const destination = resolve(root, file);
    const current = await readFile(destination, 'utf8').catch(() => undefined);
    if (current === content) continue;
    if (check) throw new Error(`${file} is stale. Run convex-platforms generate.`);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    try {
      await writeFile(temporary, content);
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  for (const name of generatedNames) {
    const file = join(outputDir, name);
    if (file in outputs) continue;
    const destination = resolve(root, file);
    const info = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!info) continue;
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${file} must be a regular generated file`);
    if (check) throw new Error(`${file} is stale. Run convex-platforms generate.`);
    await rm(destination);
  }
}

/** Discover native internal Convex Platforms definitions and deterministically generate selected contracts. */
export async function generatePlatforms(options: GeneratePlatformsOptions = {}): Promise<Manifest> {
  const root = resolve(options.root ?? '.');
  const functionsDir = options.functionsDir ?? 'convex';
  const outputDir = options.outputDir ?? 'platforms/generated';
  const uiDir = options.uiDir ?? 'platforms/ui';
  const appName = options.name ?? 'Convex Platforms';
  const functionsRoot = resolve(root, functionsDir);
  const operations: Operation[] = [];
  const widgets: Record<string, Widget> = {};
  const bundles = new Map<string, Widget>();
  for (const path of await files(root, functionsDir)) {
    const rel = relative(functionsRoot, path).replaceAll(sep, '/');
    if (
      /(^|\/)(http|schema|auth|ports)\.ts$/.test(rel) ||
      /\.config\.ts$/.test(rel) ||
      /\.(test|spec)\.ts$/.test(rel) ||
      /(^|\/)components?\//.test(rel)
    )
      continue;
    const module = await import(`${pathToFileURL(path).href}?convex-platforms=${++discoveryVersion}`);
    for (const [name, fn] of Object.entries(module)) {
      const definition: any = fn as any;
      if (
        !definition ||
        (typeof definition !== 'object' && typeof definition !== 'function') ||
        definition.platforms === undefined
      )
        continue;
      const where = `${rel}:${name}`;
      const platforms = selected(definition.platforms as Platforms, where);
      if (!platforms.length) continue;
      if (!definition.isInternal)
        throw new Error(`${where}: only native internal functions may enable platforms`);
      const metadata = (definition[validatorMetadata] ??
        definition[Symbol.for('yast.convex-platforms.validators')]) as
        { args?: Record<string, any>; returns?: any } | undefined;
      if (!metadata?.args || !metadata.returns)
        throw new Error(
          `${where}: missing Convex Platforms validator metadata; use createPlatformFunctions()`,
        );
      const args = metadata.args;
      if (
        identity.some((key) => !args[key] || args[key].isOptional === 'optional') ||
        args.orgId.kind !== 'string' ||
        args.userId.kind !== 'string' ||
        !strings(args.role)
      )
        throw new Error(`${where}: requires trusted flat orgId, userId, and role identity validators`);
      const names = operationName(path, functionsRoot, name, where, definition.resource);
      if (platforms.includes('mcp') && names.tool.length > 64)
        throw new Error(`${where}: MCP tool name exceeds 64 characters`);
      let ui: string | undefined;
      if (definition.ui !== undefined) {
        if (typeof definition.ui !== 'string') throw new Error(`${where}: ui must be a UI name`);
        if (platforms.includes('mcp')) {
          const widget = bundles.get(definition.ui) ?? (await bundleUi(root, uiDir, definition.ui));
          bundles.set(definition.ui, widget);
          ui = `ui://${appName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}/${definition.ui}-${createHash('sha256').update(widget.text).digest('hex').slice(0, 12)}.html`;
          widgets[ui] = widget;
        }
      }
      operations.push({
        name,
        ...names,
        function: `${rel.replace(/\.ts$/, '')}:${name}`,
        type: definition.isAction ? 'action' : definition.isMutation ? 'mutation' : 'query',
        platforms,
        description: typeof definition.description === 'string' ? definition.description : label(name),
        inputSchema: schema(
          v.object(Object.fromEntries(Object.entries(args).filter(([key]) => !identity.includes(key)))),
          where,
        ),
        outputSchema: schema(metadata.returns, where),
        ...(ui ? { ui } : {}),
      });
    }
  }
  for (const key of ['name', 'path', 'tool'] as const)
    if (new Set(operations.map((item) => item[key])).size !== operations.length)
      throw new Error(`Duplicate platform ${key}`);
  operations.sort((a, b) => a.path.localeCompare(b.path));
  const spec = openapi(operations, appName);
  const manifest: Manifest = { version: 1, name: appName, operations, widgets, openapi: spec };
  const output = (name: string) => join(outputDir, name);
  const outputs: Record<string, string> = {
    [output('manifest.json')]: JSON.stringify(manifest, null, 2) + '\n',
    [output('openapi.json')]: JSON.stringify(spec, null, 2) + '\n',
  };
  for (const platform of ['sdk-typescript', 'sdk-python'] as const) {
    const selectedOperations = operations.filter((operation) => operation.platforms.includes(platform));
    if (!selectedOperations.length) continue;
    Object.assign(
      outputs,
      Object.fromEntries(
        Object.entries(
          await generateClients(selectedOperations, platform, appName.toLowerCase().replace(/\s+/g, '-')),
        ).map(([file, content]) => [output(file), content]),
      ),
    );
  }
  await atomically(root, outputDir, outputs, options.check ?? false);
  return manifest;
}
