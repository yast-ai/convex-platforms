#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Command, CommanderError } from 'commander';
import type { JsonSchema, Operation } from './contract.js';
import { ApiError, request, siteOrigin } from './transport.js';
import { sessionToken } from './session.js';

const kebab = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replaceAll('_', '-').toLowerCase();
function stringInput(schema: JsonSchema): boolean {
  return schema.type === 'string' || typeof schema.const === 'string' ||
    (Array.isArray(schema.anyOf) && schema.anyOf.every((item: JsonSchema) => stringInput(item)));
}
export function validateCliOperations(value: unknown): Operation[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error('Invalid CLI manifest');
  const reserved = new Set(['constructor', 'prototype', '__proto__']);
  const keys = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new Error('Invalid CLI operation');
    const op = item as Operation;
    if (!Array.isArray(op.resource) || !op.resource.length ||
        [...op.resource, op.action].some(part => typeof part !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(part) || reserved.has(part)) ||
        ['login', 'logout', 'init', 'generate', 'plugins', 'doctor', 'help'].includes(op.resource[0]!) ||
        op.path !== '/api/v1/' + [...op.resource, op.action].join('/') ||
        !op.platforms?.includes('cli') || !op.inputSchema || typeof op.inputSchema !== 'object' ||
        !['query', 'mutation', 'action'].includes(op.type)) throw new Error('Invalid CLI operation');
    const key = [...op.resource, op.action].map(kebab).join(' ');
    if (keys.has(key)) throw new Error('Duplicate CLI command');
    keys.add(key);
    const properties = op.inputSchema.properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw new Error('Invalid CLI input schema');
    const flags = new Set<string>();
    for (const key of Object.keys(properties)) {
      const flag = kebab(key);
      if (reserved.has(key) || !/^[a-z][a-zA-Z0-9]*$/.test(key) || ['data', 'help', 'site-url'].includes(flag) || flag.startsWith('no-') || flags.has(flag))
        throw new Error('Invalid CLI argument name');
      flags.add(flag);
    }
  }
  return value as Operation[];
}
export function buildCli(operations: Operation[] = [], name = 'convex-platforms') {
  const program = new Command('convex-platforms').description(`Convex Platforms: ${name}`)
    .option('--site-url <url>', 'Target Convex site origin', process.env.CONVEX_PLATFORMS_URL)
    .configureHelp({ showGlobalOptions: true }).showHelpAfterError().exitOverride();
  const origin = () => {
    const value = program.opts<{siteUrl?: string}>().siteUrl;
    if (!value) throw new Error('Pass --site-url or set CONVEX_PLATFORMS_URL');
    return siteOrigin(value);
  };
  program.command('login').description('Sign in using WorkOS device confirmation').action(async () => {
    await sessionToken(origin(), 'login'); console.log('Signed in.');
  });
  program.command('logout').description('Remove this site’s local refresh credentials').action(async () => {
    await sessionToken(origin(), 'logout'); console.log('Local session removed.');
  });
  program.command('init').description('Add Convex Platforms to an existing Convex project')
    .option('--root <directory>', 'Project directory', '.')
    .option('--name <name>', 'Application name', 'my-app')
    .action(async options => {
      const { initializeProject } = await import('./init.js');
      await initializeProject(options); console.log('Created project wiring. See platforms/SETUP.md.');
    });
  program.command('generate').description('Generate the selected interfaces before Convex deployment')
    .option('--root <directory>', 'Project directory', '.')
    .option('--name <name>', 'Application name', 'my-app')
    .option('--check', 'Fail if generated outputs are stale, without writing')
    .action(async options => {
      const { generatePlatforms } = await import('./generate.js');
      await generatePlatforms(options); console.log('Platform outputs verified.');
    });
  program.command('plugins').description('Generate project-level OpenAI and Claude plugin bundles')
    .requiredOption('--name <name>', 'Plugin slug')
    .requiredOption('--site-url <url>', 'Public deployment origin')
    .option('--root <directory>', 'Project directory', '.')
    .option('--description <text>', 'Plugin description', 'Tools for this application')
    .action(async options => { const { generatePlugins } = await import('./plugins.js'); await generatePlugins(options); });
  program.command('doctor').description('Check deployed API, MCP discovery and CLI configuration')
    .action(async () => { const { doctor } = await import('./doctor.js'); await doctor(origin()); });
  for (const op of validateCliOperations(operations)) {
    let command = program;
    for (const part of [...op.resource, op.action].map(kebab)) {
      let child = command.commands.find(child => child.name() === part);
      if (!child) child = command.command(part);
      command = child;
    }
    command.description(op.description).option('--data <json>', 'JSON arguments, or - to read stdin');
    const properties = op.inputSchema.properties as Record<string, JsonSchema>;
    for (const key of Object.keys(properties)) command.option(`--${kebab(key)} <value>`, key);
    command.action(async function(this: Command) {
      const options = this.opts<Record<string, string | undefined>>();
      const raw = options.data === '-' ? readFileSync(0, 'utf8') : options.data;
      const input: unknown = raw === undefined ? {} : JSON.parse(raw);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('--data must be a JSON object');
      const args = input as Record<string, unknown>;
      for (const [key, schema] of Object.entries(properties)) {
        const value = options[kebab(key).replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())];
        if (value === undefined) continue;
        if (Object.hasOwn(args, key)) throw new Error(`Argument ${key} was supplied twice`);
        args[key] = stringInput(schema) ? value : JSON.parse(value);
      }
      const url = origin();
      const token = process.env.CONVEX_PLATFORMS_TOKEN || await sessionToken(url, 'token');
      console.log(JSON.stringify(await request(url, token, op.path, args), null, 2));
    });
  }
  return program;
}
export async function runCli(argv = process.argv) {
  const args = argv.slice(2);
  const local = ['init', 'generate', 'plugins'];
  const siteIndex = args.indexOf('--site-url');
  const site = siteIndex >= 0 ? args[siteIndex + 1] : args.find(arg => arg.startsWith('--site-url='))?.slice(11) ?? process.env.CONVEX_PLATFORMS_URL;
  const command = args.filter((_, i) => siteIndex < 0 || (i !== siteIndex && i !== siteIndex + 1)).find(arg => !arg.startsWith('-'));
  let operations: Operation[] = [];
  let name: string | undefined;
  if (site && command && ![...local, 'login', 'logout', 'doctor'].includes(command)) {
    const response = await fetch(`${siteOrigin(site)}/cli/manifest`, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
    const manifest = await response.json().catch(() => null) as { name?: string; operations?: unknown } | null;
    if (!response.ok || !manifest) throw new Error('Unable to discover deployment commands');
    operations = validateCliOperations(manifest.operations);
    name = manifest.name;
  }
  const program = buildCli(operations, name);
  if (!args.length) program.outputHelp(); else await program.parseAsync(argv);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(error => {
    if (error instanceof CommanderError) process.exitCode = error.exitCode;
    else {
      console.error(error instanceof ApiError ? JSON.stringify({status: error.status, error: error.data}) : error instanceof Error ? error.message : 'Command failed');
      process.exitCode = 1;
    }
  });
}
