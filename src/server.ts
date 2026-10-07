import { WorkOS, type ValidateApiKeyResponse } from '@workos-inc/node';
import {
  httpActionGeneric,
  makeFunctionReference,
  type GenericActionCtx,
  type GenericDataModel,
  type HttpActionBuilder,
  type HttpRouter,
} from 'convex/server';
import { ConvexError, convexToJson, type Value } from 'convex/values';
import type { Identity, Manifest, Operation, Widget } from './contract.js';
import { createMcpOAuth, type McpOAuth } from './oauth.js';

const maxInputBytes = 1_000_000;
const identityKeys = ['orgId', 'userId', 'role', 'user', 'args'];
const cspDirectives = new Set(['connectDomains', 'resourceDomains', 'frameDomains', 'baseUriDomains']);
type RuntimeCtx = GenericActionCtx<GenericDataModel>;
type Claims = { subject?: string; issuer?: string; org_id?: string; aud?: string | string[] };
export type WorkOSPort = {
  apiKeys: Pick<WorkOS['apiKeys'], 'createValidation'>;
  userManagement: Pick<WorkOS['userManagement'], 'listOrganizationMemberships'>;
};

export type PlatformServerConfig = {
  manifest: Manifest;
  workos: { clientId: string; apiKey: string; authkitUrl: string; siteUrl: string };
  /** Resolve multi-role memberships only when the app declares an explicit ordering. */
  rolePriority?: string[];
  corsOrigins?: string[];
  /** Test seam. Production apps should let the runtime construct the WorkOS SDK client. */
  workosClient?: WorkOSPort;
};

export type PlatformServer = {
  fetch(request: Request, ctx: RuntimeCtx): Promise<Response>;
  registerRoutes(http: HttpRouter, actionBuilder?: HttpActionBuilder): void;
  oauth: McpOAuth;
};

class RuntimeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function isLoopback(url: URL) {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
}

function safeOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a URL`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url)))
    throw new Error(`${name} must use HTTPS except for a loopback development URL`);
  if (url.username || url.password) throw new Error(`${name} must not include credentials`);
  if (url.pathname !== '/' || url.search || url.hash) throw new Error(`${name} must be an origin`);
  return url.origin;
}

function validateWidget(name: string, widget: Widget) {
  if (!widget || typeof widget.text !== 'string') throw new Error(`Widget ${name} must contain HTML text`);
  for (const [directive, domains] of Object.entries(widget.csp ?? {})) {
    if (!cspDirectives.has(directive))
      throw new Error(`Widget ${name} has an unsupported ${directive} CSP directive`);
    if (!Array.isArray(domains)) throw new Error(`Widget ${name} has an invalid ${directive} CSP directive`);
    for (const domain of domains) safeOrigin(domain, `Widget ${name} ${directive}`);
  }
}

function validateManifest(manifest: Manifest) {
  if (!manifest || manifest.version !== 1 || !manifest.name || !Array.isArray(manifest.operations))
    throw new Error('manifest must be version 1 with a name and operations');
  const names = new Set<string>();
  const paths = new Set<string>();
  const tools = new Set<string>();
  const functions = new Set<string>();
  for (const operation of manifest.operations) {
    if (!operation.name || !operation.function || !operation.path || !operation.tool)
      throw new Error('Every operation needs name, function, path, and tool');
    if (!['query', 'mutation', 'action'].includes(operation.type))
      throw new Error(`Invalid operation type: ${operation.name}`);
    if (!operation.path.startsWith('/api/v1/'))
      throw new Error(`API path must start with /api/v1/: ${operation.name}`);
    for (const [seen, value, label] of [
      [names, operation.name, 'name'],
      [paths, operation.path, 'path'],
      [tools, operation.tool, 'tool'],
      [functions, operation.function, 'function'],
    ] as const) {
      if (seen.has(value)) throw new Error(`Duplicate operation ${label}: ${value}`);
      seen.add(value);
    }
    if (!Array.isArray(operation.platforms))
      throw new Error(`Operation ${operation.name} has invalid platforms`);
    if (operation.ui && !manifest.widgets[operation.ui])
      throw new Error(`Operation ${operation.name} references an unknown widget`);
  }
  for (const [name, widget] of Object.entries(manifest.widgets)) validateWidget(name, widget);
}

function businessError(error: unknown): RuntimeError | null {
  if (
    !(error instanceof ConvexError) ||
    !error.data ||
    typeof error.data !== 'object' ||
    Array.isArray(error.data)
  )
    return null;
  const data = error.data as Record<string, unknown>;
  const status = data.status;
  const code = data.code;
  if (
    typeof status !== 'number' ||
    !Number.isInteger(status) ||
    status < 400 ||
    status > 499 ||
    typeof code !== 'string' ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(code)
  )
    return null;
  return new RuntimeError(status, code);
}

function errorResponse(error: unknown, mcp = false) {
  const runtime =
    error instanceof RuntimeError ? error : (businessError(error) ?? new RuntimeError(500, 'request_failed'));
  if (mcp)
    return Response.json(
      { jsonrpc: '2.0', error: { code: runtime.status, message: runtime.code }, id: null },
      { status: runtime.status },
    );
  return Response.json({ status: 'error', error: { code: runtime.code } }, { status: runtime.status });
}

type JsonRpcId = string | number | null;

function jsonRpcError(error: unknown, id: JsonRpcId) {
  const runtime =
    error instanceof RuntimeError ? error : (businessError(error) ?? new RuntimeError(500, 'request_failed'));
  return Response.json(
    { jsonrpc: '2.0', error: { code: runtime.status, message: runtime.code }, id },
    { status: runtime.status },
  );
}

function cors(request: Request, allowed: Set<string>): Record<string, string> {
  const origin = request.headers.get('origin');
  return origin && allowed.has(origin)
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Expose-Headers': 'WWW-Authenticate',
        Vary: 'Origin',
      }
    : {};
}

async function jsonInput(request: Request): Promise<Record<string, Value>> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(length) || length > maxInputBytes) throw new RuntimeError(413, 'input_too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxInputBytes)
    throw new RuntimeError(413, 'input_too_large');
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new RuntimeError(400, 'invalid_json');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new RuntimeError(400, 'expected_json_object');
  for (const key of identityKeys) if (key in input) throw new RuntimeError(400, 'client_identity_forbidden');
  return input as Record<string, Value>;
}

function bearer(request: Request) {
  const value = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!value) throw new RuntimeError(401, 'authentication_required');
  return value;
}

function claimString(claims: Claims, key: keyof Claims) {
  const value = claims[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Build an edge runtime. It has no module-time environment reads so generator
 * discovery can load a consuming app without credentials.
 */
export function createPlatformServer(config: PlatformServerConfig): PlatformServer {
  validateManifest(config.manifest);
  const siteOrigin = safeOrigin(config.workos.siteUrl, 'workos.siteUrl');
  const oauth = createMcpOAuth(config.workos.authkitUrl, config.workos.siteUrl);
  if (!config.workos.clientId || !config.workos.apiKey)
    throw new Error('workos.clientId and workos.apiKey are required');
  const rolePriority = config.rolePriority ?? [];
  if (new Set(rolePriority).size !== rolePriority.length)
    throw new Error('rolePriority cannot contain duplicates');
  const api = new Map(
    config.manifest.operations
      .filter((op) => op.platforms.some((item) => item !== 'mcp'))
      .map((op) => [op.path, op]),
  );
  const tools = new Map(
    config.manifest.operations.filter((op) => op.platforms.includes('mcp')).map((op) => [op.tool, op]),
  );
  const workos: WorkOSPort =
    config.workosClient ?? new WorkOS(config.workos.apiKey, { clientId: config.workos.clientId });
  const apiOrigins = new Set([
    siteOrigin,
    ...(config.corsOrigins ?? []).map((origin) => safeOrigin(origin, 'corsOrigins')),
  ]);
  const mcpOrigins = new Set([...apiOrigins, 'https://chatgpt.com', 'https://claude.ai']);

  async function membership(orgId: string, userId: string): Promise<Identity> {
    const memberships = await workos.userManagement.listOrganizationMemberships({
      userId,
      organizationId: orgId,
      statuses: ['active'],
      limit: 10,
    });
    const current = memberships.data.filter(
      (item) => item.status === 'active' && item.organizationId === orgId && item.userId === userId,
    );
    if (current.length !== 1) throw new RuntimeError(403, 'active_membership_required');
    const roles = (current[0]?.roles ?? (current[0]?.role ? [current[0].role] : []))
      .map((role) => role.slug)
      .filter((role): role is string => Boolean(role));
    if (roles.length === 0) throw new RuntimeError(403, 'membership_role_required');
    if (roles.length === 1) return { orgId, userId, role: roles[0]! };
    const selected = rolePriority.find((role) => roles.includes(role));
    if (!selected) throw new RuntimeError(403, 'ambiguous_membership_role');
    return { orgId, userId, role: selected };
  }

  async function sessionIdentity(ctx: RuntimeCtx, mcp: boolean): Promise<Identity> {
    const raw = await ctx.auth.getUserIdentity().catch(() => null);
    const claims = (raw ?? {}) as Claims;
    const sessionIssuers = new Set([
      'https://api.workos.com/',
      `https://api.workos.com/user_management/${config.workos.clientId}`,
    ]);
    if (
      (mcp && claims.issuer !== new URL(config.workos.authkitUrl).origin) ||
      (!mcp && !sessionIssuers.has(claims.issuer ?? ''))
    )
      throw new RuntimeError(401, 'invalid_token_issuer');
    if (mcp) {
      const aud = claims.aud;
      const audience = Array.isArray(aud) ? aud : aud ? [aud] : [];
      if (!audience.includes(oauth.resource.href)) throw new RuntimeError(401, 'invalid_token_audience');
    }
    const userId = claimString(claims, 'subject');
    const orgId = claimString(claims, 'org_id');
    if (!userId || !orgId) throw new RuntimeError(403, 'organization_identity_required');
    return membership(orgId, userId);
  }

  async function apiIdentity(ctx: RuntimeCtx, request: Request) {
    const token = bearer(request);
    if (!token.startsWith('sk_')) return sessionIdentity(ctx, false);
    let validated: ValidateApiKeyResponse;
    try {
      validated = await workos.apiKeys.createValidation({ value: token });
    } catch {
      throw new RuntimeError(401, 'invalid_api_key');
    }
    const key = validated.apiKey;
    if (key?.owner?.type !== 'user' || !key.owner.id || !key.owner.organizationId)
      throw new RuntimeError(401, 'invalid_api_key');
    if (!key.permissions?.includes('api:access')) throw new RuntimeError(403, 'api_permission_required');
    return membership(key.owner.organizationId, key.owner.id);
  }

  async function invoke(
    ctx: RuntimeCtx,
    operation: Operation,
    identity: Identity,
    input: Record<string, Value>,
  ) {
    const args = { orgId: identity.orgId, userId: identity.userId, role: identity.role, ...input };
    const result =
      operation.type === 'query'
        ? await ctx.runQuery(
            makeFunctionReference<'query', Record<string, Value>, Value>(operation.function),
            args,
          )
        : operation.type === 'mutation'
          ? await ctx.runMutation(
              makeFunctionReference<'mutation', Record<string, Value>, Value>(operation.function),
              args,
            )
          : await ctx.runAction(
              makeFunctionReference<'action', Record<string, Value>, Value>(operation.function),
              args,
            );
    return convexToJson(result);
  }

  async function handleMcp(request: Request, ctx: RuntimeCtx): Promise<Response> {
    if (request.headers.get('mcp-session-id') || request.headers.get('mcp-protocol-version') === '2024-11-05')
      throw new RuntimeError(400, 'legacy_mcp_not_supported');
    bearer(request);
    const requestBody = await jsonInput(request);
    const hasId = Object.prototype.hasOwnProperty.call(requestBody, 'id');
    const idValue = requestBody.id;
    const id: JsonRpcId =
      hasId && (idValue === null || typeof idValue === 'string' || typeof idValue === 'number')
        ? idValue
        : null;
    const fail = (error: RuntimeError) => {
      const response = jsonRpcError(error, id);
      for (const [name, value] of Object.entries(cors(request, mcpOrigins)))
        response.headers.set(name, value);
      return response;
    };
    if (requestBody.jsonrpc !== '2.0' || typeof requestBody.method !== 'string' || !requestBody.method)
      return fail(new RuntimeError(400, 'invalid_jsonrpc_request'));
    if (hasId && idValue !== null && typeof idValue !== 'string' && typeof idValue !== 'number')
      return fail(new RuntimeError(400, 'invalid_jsonrpc_id'));
    const method = requestBody.method;
    const params = requestBody.params;
    const initVersion =
      typeof params === 'object' && params && !Array.isArray(params)
        ? (params as Record<string, unknown>).protocolVersion
        : undefined;
    if (method === 'initialize' && initVersion === '2024-11-05')
      return fail(new RuntimeError(400, 'legacy_mcp_not_supported'));
    try {
      const identity = await sessionIdentity(ctx, true);
      if (!hasId) {
        if (method.startsWith('notifications/'))
          return new Response(null, { status: 202, headers: cors(request, mcpOrigins) });
        throw new RuntimeError(400, 'jsonrpc_id_required');
      }
      const respond = (result: unknown) =>
        Response.json({ jsonrpc: '2.0', id, result }, { headers: cors(request, mcpOrigins) });
      if (method === 'initialize')
        return respond({
          protocolVersion: '2025-06-18',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: config.manifest.name, version: '1' },
        });
      if (method === 'tools/list')
        return respond({
          tools: [...tools.values()].map((op) => ({
            name: op.tool,
            description: op.description,
            inputSchema: op.inputSchema,
            outputSchema: { type: 'object', properties: { result: op.outputSchema }, required: ['result'] },
            ...(op.ui ? { _meta: { ui: { resourceUri: op.ui } } } : {}),
          })),
        });
      if (method === 'resources/list')
        return respond({
          resources: Object.keys(config.manifest.widgets).map((uri) => ({
            uri,
            name: uri,
            mimeType: 'text/html;profile=mcp-app',
          })),
        });
      if (method === 'resources/read') {
        const uri =
          typeof params === 'object' && params ? (params as Record<string, unknown>).uri : undefined;
        const widget = typeof uri === 'string' ? config.manifest.widgets[uri] : undefined;
        if (!widget) throw new RuntimeError(404, 'resource_not_found');
        return respond({
          contents: [
            {
              uri,
              text: widget.text,
              mimeType: 'text/html;profile=mcp-app',
              _meta: {
                ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [], ...widget.csp } },
              },
            },
          ],
        });
      }
      if (method === 'tools/call') {
        const values = typeof params === 'object' && params ? (params as Record<string, unknown>) : null;
        const name = typeof values?.name === 'string' ? values.name : '';
        const operation = tools.get(name);
        if (!operation) throw new RuntimeError(404, 'tool_not_found');
        const argumentsValue = values?.arguments ?? {};
        if (typeof argumentsValue !== 'object' || Array.isArray(argumentsValue))
          throw new RuntimeError(400, 'expected_json_object');
        for (const key of identityKeys)
          if (key in argumentsValue) throw new RuntimeError(400, 'client_identity_forbidden');
        try {
          const result = await invoke(ctx, operation, identity, argumentsValue as Record<string, Value>);
          return respond({
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: { result },
          });
        } catch (error) {
          const code = error instanceof RuntimeError ? error.code : 'operation_failed';
          return respond({ isError: true, content: [{ type: 'text', text: JSON.stringify({ code }) }] });
        }
      }
      throw new RuntimeError(404, 'method_not_found');
    } catch (error) {
      const response = jsonRpcError(error, id);
      for (const [name, value] of Object.entries(cors(request, mcpOrigins)))
        response.headers.set(name, value);
      return response;
    }
  }

  async function fetch(request: Request, ctx: RuntimeCtx) {
    const path = new URL(request.url).pathname;
    try {
      if (request.method === 'OPTIONS')
        return new Response(null, {
          status: 204,
          headers: {
            ...cors(request, path === '/mcp' ? mcpOrigins : apiOrigins),
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
          },
        });
      if (path === oauth.metadataPath && request.method === 'GET')
        return Response.json(oauth.metadata, { headers: { 'Access-Control-Allow-Origin': '*' } });
      if (path === '/cli/config' && request.method === 'GET')
        return Response.json({ clientId: config.workos.clientId });
      if (path === '/cli/manifest' && request.method === 'GET')
        return Response.json({
          name: config.manifest.name,
          operations: config.manifest.operations.filter((op) => op.platforms.includes('cli')),
        });
      if (path === '/api-reference/openapi.json' && request.method === 'GET')
        return Response.json(config.manifest.openapi);
      if (path === '/mcp') {
        if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
        return await handleMcp(request, ctx);
      }
      const operation = api.get(path);
      if (!operation || request.method !== 'POST') throw new RuntimeError(404, 'operation_not_found');
      const identity = await apiIdentity(ctx, request);
      const input = await jsonInput(request);
      return Response.json(
        { status: 'success', value: await invoke(ctx, operation, identity, input) },
        { headers: cors(request, apiOrigins) },
      );
    } catch (error) {
      const isMcp = path === '/mcp';
      const response = errorResponse(error, isMcp);
      for (const [name, value] of Object.entries(cors(request, isMcp ? mcpOrigins : apiOrigins)))
        response.headers.set(name, value);
      if (isMcp && error instanceof RuntimeError && error.status === 401)
        response.headers.set('WWW-Authenticate', `Bearer resource_metadata="${oauth.metadataUrl}"`);
      return response;
    }
  }

  return {
    fetch,
    oauth,
    registerRoutes(http, actionBuilder = httpActionGeneric) {
      const handler = actionBuilder((ctx, request) => fetch(request, ctx));
      if (api.size)
        for (const method of ['POST', 'OPTIONS'] as const)
          http.route({ pathPrefix: '/api/v1/', method, handler });
      for (const method of ['POST', 'OPTIONS', 'GET', 'DELETE'] as const)
        http.route({ path: '/mcp', method, handler });
      http.route({ path: oauth.metadataPath, method: 'GET', handler });
      http.route({ path: '/cli/config', method: 'GET', handler });
      http.route({ path: '/cli/manifest', method: 'GET', handler });
      http.route({ path: '/api-reference/openapi.json', method: 'GET', handler });
    },
  };
}

/** Convenience mount for conventional Convex `convex/http.ts` files. */
export function registerPlatforms(
  http: HttpRouter,
  config: PlatformServerConfig,
  actionBuilder?: HttpActionBuilder,
) {
  return createPlatformServer(config).registerRoutes(http, actionBuilder);
}
