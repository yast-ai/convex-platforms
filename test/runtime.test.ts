import { describe, expect, test } from 'bun:test';
import { httpRouter } from 'convex/server';
import { ConvexError } from 'convex/values';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { ApiKey, OrganizationMembership, ValidateApiKeyResponse } from '@workos-inc/node';
import type { Manifest } from '../src/contract.js';
import { createPlatformServer, type WorkOSPort } from '../src/server.js';

const manifest: Manifest = {
  version: 1,
  name: 'Convex Platforms',
  openapi: { openapi: '3.1.0' },
  widgets: {
    'ui://todos': { text: '<main>Todos</main>', csp: { connectDomains: ['https://example.com'] } },
  },
  operations: [
    {
      name: 'listTodos',
      resource: ['todos'],
      action: 'list',
      tool: 'todos_list',
      path: '/api/v1/todos/list',
      function: 'todos:listTodos',
      type: 'query',
      platforms: ['api', 'cli', 'mcp'],
      description: 'List todos',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'array' },
      ui: 'ui://todos',
    },
    {
      name: 'createTodo',
      resource: ['todos'],
      action: 'create',
      tool: 'todos_create',
      path: '/api/v1/todos/create',
      function: 'todos:createTodo',
      type: 'mutation',
      platforms: ['api'],
      description: 'Create todo',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
    },
    {
      name: 'syncTodo',
      resource: ['todos'],
      action: 'sync',
      tool: 'todos_sync',
      path: '/api/v1/todos/sync',
      function: 'todos:syncTodo',
      type: 'action',
      platforms: ['api'],
      description: 'Sync todo',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
    },
  ],
};

function runtime(options: { permissions?: string[]; active?: boolean } = {}) {
  const calls: Array<{ kind: string; args: unknown }> = [];
  const apiKey = {
    object: 'api_key',
    id: 'key_1',
    owner: { type: 'user' as const, id: 'user_1', organizationId: 'org_1' },
    name: 'Test key',
    obfuscatedValue: 'sk_***',
    lastUsedAt: null,
    permissions: options.permissions ?? ['api:access'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } satisfies ApiKey;
  const membership = {
    object: 'organization_membership' as const,
    id: 'om_1',
    organizationId: 'org_1',
    organizationName: 'Test organization',
    status: 'active' as const,
    userId: 'user_1',
    directoryManaged: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    customAttributes: {},
    role: { slug: 'builder' },
    roles: [{ slug: 'builder' }],
  } satisfies OrganizationMembership;
  const validation = { apiKey } satisfies ValidateApiKeyResponse;
  const workosClient = {
    apiKeys: { createValidation: async () => validation },
    userManagement: {
      listOrganizationMemberships: async () =>
        ({ data: options.active === false ? [] : [membership] }) as Awaited<
          ReturnType<WorkOSPort['userManagement']['listOrganizationMemberships']>
        >,
    },
  } satisfies WorkOSPort;
  const server = createPlatformServer({
    manifest,
    workos: {
      clientId: 'client_test',
      apiKey: 'secret',
      authkitUrl: 'https://auth.example.com',
      siteUrl: 'https://app.example.com',
    },
    workosClient,
  });
  const ctx = {
    auth: {
      getUserIdentity: async () => ({
        issuer: 'https://auth.example.com',
        subject: 'user_1',
        org_id: 'org_1',
        aud: ['https://app.example.com/mcp'],
      }),
    },
    runQuery: async (_reference: unknown, args: unknown) => {
      calls.push({ kind: 'query', args });
      return [{ id: 'todo_1' }];
    },
    runMutation: async (_reference: unknown, args: unknown) => {
      calls.push({ kind: 'mutation', args });
      return { id: 'todo_2' };
    },
    runAction: async (_reference: unknown, args: unknown) => {
      calls.push({ kind: 'action', args });
      return { synced: true };
    },
  };
  return { server, ctx, calls };
}

describe('Convex Platforms runtime', () => {
  test('uses API-key ownership, permission, membership, and flat trusted identity', async () => {
    const { server, ctx, calls } = runtime();
    const response = await server.fetch(
      new Request('https://app.example.com/api/v1/todos/list', {
        method: 'POST',
        headers: { Authorization: 'Bearer sk_test' },
        body: JSON.stringify({ limit: 10 }),
      }),
      ctx as never,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'success', value: [{ id: 'todo_1' }] });
    expect(calls).toEqual([
      { kind: 'query', args: { orgId: 'org_1', userId: 'user_1', role: 'builder', limit: 10 } },
    ]);
  });

  test('rejects forged identity, missing API permission, and revoked membership before dispatch', async () => {
    const forged = runtime();
    const forgedResponse = await forged.server.fetch(
      new Request('https://app.example.com/api/v1/todos/list', {
        method: 'POST',
        headers: { Authorization: 'Bearer sk_test' },
        body: JSON.stringify({ orgId: 'org_other' }),
      }),
      forged.ctx as never,
    );
    expect(forgedResponse.status).toBe(400);
    expect(forged.calls).toHaveLength(0);

    const permission = runtime({ permissions: [] });
    const permissionResponse = await permission.server.fetch(
      new Request('https://app.example.com/api/v1/todos/list', {
        method: 'POST',
        headers: { Authorization: 'Bearer sk_test' },
        body: '{}',
      }),
      permission.ctx as never,
    );
    expect(permissionResponse.status).toBe(403);
    expect(permission.calls).toHaveLength(0);

    const revoked = runtime({ active: false });
    const revokedResponse = await revoked.server.fetch(
      new Request('https://app.example.com/api/v1/todos/list', {
        method: 'POST',
        headers: { Authorization: 'Bearer sk_test' },
        body: '{}',
      }),
      revoked.ctx as never,
    );
    expect(revokedResponse.status).toBe(403);
    expect(revoked.calls).toHaveLength(0);
  });

  test('dispatches native query, mutation, and action calls', async () => {
    const { server, ctx, calls } = runtime();
    for (const path of ['list', 'create', 'sync']) {
      const response = await server.fetch(
        new Request(`https://app.example.com/api/v1/todos/${path}`, {
          method: 'POST',
          headers: { Authorization: 'Bearer sk_test' },
          body: '{}',
        }),
        ctx as never,
      );
      expect(response.status).toBe(200);
    }
    expect(calls.map((call) => call.kind)).toEqual(['query', 'mutation', 'action']);
  });

  test('preserves safe Convex business errors and hides unknown failures', async () => {
    const known = runtime();
    known.ctx.runQuery = async () => {
      throw new ConvexError({ code: 'not_found', status: 404 });
    };
    const knownResponse = await known.server.fetch(
      new Request('https://app.example.com/api/v1/todos/list', {
        method: 'POST',
        headers: { Authorization: 'Bearer sk_test' },
        body: '{}',
      }),
      known.ctx as never,
    );
    expect(knownResponse.status).toBe(404);
    expect(await knownResponse.json()).toEqual({ status: 'error', error: { code: 'not_found' } });

    const unknown = runtime();
    unknown.ctx.runQuery = async () => {
      throw new Error('database password leaked');
    };
    const unknownResponse = await unknown.server.fetch(
      new Request('https://app.example.com/api/v1/todos/list', {
        method: 'POST',
        headers: { Authorization: 'Bearer sk_test' },
        body: '{}',
      }),
      unknown.ctx as never,
    );
    expect(unknownResponse.status).toBe(500);
    expect(await unknownResponse.text()).not.toContain('password');
  });

  test('challenges missing MCP credentials and rejects an invalid session issuer', async () => {
    const { server, ctx } = runtime();
    const challenge = await server.fetch(
      new Request('https://app.example.com/mcp', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      }),
      ctx as never,
    );
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get('www-authenticate')).toContain('oauth-protected-resource');

    const wrongIssuer = {
      ...ctx,
      auth: {
        getUserIdentity: async () => ({
          issuer: 'https://evil.example.com',
          subject: 'user_1',
          org_id: 'org_1',
        }),
      },
    };
    const response = await server.fetch(
      new Request('https://app.example.com/api/v1/todos/list', {
        method: 'POST',
        headers: { Authorization: 'Bearer session' },
        body: '{}',
      }),
      wrongIssuer as never,
    );
    expect(response.status).toBe(401);
  });

  test('does not accept a Connect token on public API routes', async () => {
    const { server, ctx } = runtime();
    const response = await server.fetch(
      new Request('https://app.example.com/api/v1/todos/list', {
        method: 'POST',
        headers: { Authorization: 'Bearer connect_token' },
        body: '{}',
      }),
      ctx as never,
    );
    expect(response.status).toBe(401);
  });

  test('rejects MCP tokens for the wrong resource audience', async () => {
    const { server, ctx } = runtime();
    const wrongAudience = {
      ...ctx,
      auth: {
        getUserIdentity: async () => ({
          issuer: 'https://auth.example.com',
          subject: 'user_1',
          org_id: 'org_1',
          aud: ['https://other.example.com/mcp'],
        }),
      },
    };
    const response = await server.fetch(
      new Request('https://app.example.com/mcp', {
        method: 'POST',
        headers: { Authorization: 'Bearer session' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      }),
      wrongAudience as never,
    );
    expect(response.status).toBe(401);
  });

  test('lists MCP tools, serves vetted widget resources, and mounts routes', async () => {
    const { server, ctx } = runtime();
    const tools = await server.fetch(
      new Request('https://app.example.com/mcp', {
        method: 'POST',
        headers: { Authorization: 'Bearer session', 'MCP-Protocol-Version': '2025-06-18' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
      ctx as never,
    );
    expect(tools.status).toBe(200);
    expect(await tools.json()).toMatchObject({ result: { tools: [{ name: 'todos_list' }] } });

    const resource = await server.fetch(
      new Request('https://app.example.com/mcp', {
        method: 'POST',
        headers: { Authorization: 'Bearer session' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'resources/read',
          params: { uri: 'ui://todos' },
        }),
      }),
      ctx as never,
    );
    expect(resource.status).toBe(200);
    expect(await resource.text()).toContain('Todos');

    const router = httpRouter();
    server.registerRoutes(router);
    expect(router.getRoutes().map(([path]) => path)).toContain('/cli/manifest');
  });

  test('keeps ChatGPT and Claude CORS on MCP only', async () => {
    const { server, ctx } = runtime();
    const api = await server.fetch(
      new Request('https://app.example.com/api/v1/todos/list', {
        method: 'POST',
        headers: { Authorization: 'Bearer sk_test', Origin: 'https://chatgpt.com' },
        body: '{}',
      }),
      ctx as never,
    );
    expect(api.headers.get('access-control-allow-origin')).toBeNull();
    const mcp = await server.fetch(
      new Request('https://app.example.com/mcp', {
        method: 'POST',
        headers: { Authorization: 'Bearer session', Origin: 'https://chatgpt.com' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
      ctx as never,
    );
    expect(mcp.headers.get('access-control-allow-origin')).toBe('https://chatgpt.com');
  });

  test('accepts MCP notifications and preserves a request id in JSON-RPC errors', async () => {
    const { server, ctx } = runtime();
    const notification = await server.fetch(
      new Request('https://app.example.com/mcp', {
        method: 'POST',
        headers: { Authorization: 'Bearer session' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      }),
      ctx as never,
    );
    expect(notification.status).toBe(202);

    const malformed = await server.fetch(
      new Request('https://app.example.com/mcp', {
        method: 'POST',
        headers: { Authorization: 'Bearer session' },
        body: JSON.stringify({ jsonrpc: '1.0', id: 'request-1', method: 'tools/list' }),
      }),
      ctx as never,
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ id: 'request-1', error: { code: 400 } });
  });

  test('works with the official Streamable HTTP MCP client', async () => {
    const { server, ctx } = runtime();
    const transport = new StreamableHTTPClientTransport(new URL('https://app.example.com/mcp'), {
      authProvider: { token: async () => 'session' },
      fetch: (input, init) => {
        const request = input instanceof Request ? new Request(input, init) : new Request(input, init);
        return server.fetch(request, ctx as never);
      },
    });
    const client = new Client({ name: 'test-client', version: '1' }, {});
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toContain('todos_list');
    await transport.close();
  });

  test('rejects duplicate manifest route names and insecure widget CSP', () => {
    expect(() =>
      createPlatformServer({
        manifest: { ...manifest, operations: [...manifest.operations, { ...manifest.operations[0]! }] },
        workos: {
          clientId: 'x',
          apiKey: 'x',
          authkitUrl: 'https://auth.example.com',
          siteUrl: 'https://app.example.com',
        },
      }),
    ).toThrow('Duplicate operation');
    expect(() =>
      createPlatformServer({
        manifest: {
          ...manifest,
          widgets: {
            ...manifest.widgets,
            bad: { text: 'x', csp: { connectDomains: ['http://example.com'] } },
          },
        },
        workos: {
          clientId: 'x',
          apiKey: 'x',
          authkitUrl: 'https://auth.example.com',
          siteUrl: 'https://app.example.com',
        },
      }),
    ).toThrow('HTTPS');
    expect(() =>
      createPlatformServer({
        manifest: {
          ...manifest,
          widgets: { ...manifest.widgets, bad: { text: 'x', csp: { scriptDomains: [] } as never } },
        },
        workos: {
          clientId: 'x',
          apiKey: 'x',
          authkitUrl: 'https://auth.example.com',
          siteUrl: 'https://app.example.com',
        },
      }),
    ).toThrow('unsupported');
    expect(() =>
      createPlatformServer({
        manifest,
        workos: {
          clientId: 'x',
          apiKey: 'x',
          authkitUrl: 'https://user:pass@auth.example.com',
          siteUrl: 'https://app.example.com',
        },
      }),
    ).toThrow('credentials');
  });
});
