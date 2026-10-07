import { describe, expect, test } from 'bun:test';
import { httpRouter } from 'convex/server';
import type { Manifest } from '../src/contract.js';
import { createPlatformServer } from '../src/server.js';

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
  const server = createPlatformServer({
    manifest,
    workos: {
      clientId: 'client_test',
      apiKey: 'secret',
      authkitUrl: 'https://auth.example.com',
      siteUrl: 'https://app.example.com',
    },
    workosClient: {
      apiKeys: {
        createValidation: async () => ({
          apiKey: {
            owner: { type: 'user', id: 'user_1', organizationId: 'org_1' },
            permissions: options.permissions ?? ['api:access'],
          },
        }),
      },
      userManagement: {
        listOrganizationMemberships: async () => ({
          data:
            options.active === false
              ? []
              : [
                  {
                    status: 'active',
                    userId: 'user_1',
                    organizationId: 'org_1',
                    roles: [{ slug: 'builder' }],
                  },
                ],
        }),
      },
    },
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
  });
});
