import { describe, expect, mock, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkOS } from '@workos-inc/node';
import { convexTest } from 'convex-test';
import { defineSchema, httpRouter, makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';
import { createPlatforms } from '../src/platforms.js';
import { generatePlatforms } from '../src/generate.js';
import type { Manifest } from '../src/contract.js';

const identity = { orgId: 'org_test', userId: 'user_test', role: 'admin' as const };
const manifest: Manifest = {
  version: 1,
  name: 'Integration',
  widgets: {},
  openapi: { openapi: '3.1.0' },
  operations: [
    {
      name: 'getAccount',
      resource: ['account'],
      action: 'get',
      tool: 'account_get',
      path: '/api/v1/account/get',
      function: 'platforms:getAccount',
      type: 'query',
      platforms: ['api', 'mcp'],
      description: 'Get account',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
    },
  ],
};
function setup() {
  const getClient = mock(() => new WorkOS('sk_test', { clientId: 'client_test' }));
  const getServerConfig = mock(() => ({
    clientId: 'client_test',
    apiKey: 'sk_test',
    authkitUrl: 'https://test.authkit.app',
    siteUrl: 'https://test.convex.site',
  }));
  const getWebhookSecret = mock(() => 'webhook_test_secret');
  const syncEvent = mock(async () => undefined);
  const platforms = createPlatforms({
    role: v.union(v.literal('admin'), v.literal('member')),
    roles: ['admin', 'member'],
    adminRoles: ['admin'],
    defaultRole: 'member',
    getClient,
    getServerConfig,
    getSessionIssuers: () => ['https://api.workos.com/'],
    resolveIdentity: async () => identity,
    webhook: { getWebhookSecret, isUserSynced: async () => false, syncEvent },
  });
  return { platforms, getClient, getServerConfig, getWebhookSecret, syncEvent };
}

describe('single Platforms integration', () => {
  test('composes native builders and selected WorkOS exports without reading deployment settings', async () => {
    const s = setup();
    expect(s.getClient).not.toHaveBeenCalled();
    expect(s.getServerConfig).not.toHaveBeenCalled();
    expect(s.getWebhookSecret).not.toHaveBeenCalled();
    const fn = s.platforms.internalQuery({ args: {}, returns: v.string(), handler: () => 'custom' });
    expect(fn.isInternal).toBe(true);
    expect(s.platforms.functions.getAccount.isQuery).toBe(true);
    expect(s.platforms.publicFunctions.getAccount.isPublic).toBe(true);
    const t = convexTest(defineSchema({}), {
      './_generated/api.ts': async () => ({}),
      './platforms.ts': async () => ({ getAccount: s.platforms.functions.getAccount, custom: fn }),
    });
    expect(await t.query(makeFunctionReference<'query'>('platforms:getAccount'), identity)).toEqual(identity);
    expect(await t.query(makeFunctionReference<'query'>('platforms:custom'), {})).toBe('custom');
    expect(s.getClient).not.toHaveBeenCalled();
  });

  test('omitted public authentication fails closed before reading settings or calling WorkOS', async () => {
    const getServerConfig = mock(() => {
      throw new Error('Settings must stay lazy');
    });
    const platforms = createPlatforms({
      role: v.union(v.literal('admin'), v.literal('member')),
      roles: ['admin', 'member'],
      adminRoles: ['admin'],
      defaultRole: 'member',
      getServerConfig,
      getSessionIssuers: () => ['https://api.workos.com/'],
    });
    const t = convexTest(defineSchema({}), {
      './_generated/api.ts': async () => ({}),
      './platforms.ts': async () => ({
        getAccountPublic: platforms.publicFunctions.getAccount,
        getAccount: platforms.functions.getAccount,
      }),
    });
    await expect(
      t
        .withIdentity({ subject: 'user_test', issuer: 'https://api.workos.com/', org_id: 'org_test' })
        .query(makeFunctionReference<'query'>('platforms:getAccountPublic'), {}),
    ).rejects.toThrow('unauthenticated');
    await expect(
      t.query(makeFunctionReference<'query'>('platforms:getAccount'), { ...identity, role: 'owner' }),
    ).rejects.toThrow();
    expect(getServerConfig).not.toHaveBeenCalled();
  });

  test('rejects conflicting personal organization prefixes before any lazy callback executes', () => {
    const getServerConfig = mock(() => {
      throw new Error('Must stay lazy');
    });
    expect(() =>
      createPlatforms({
        role: v.literal('admin'),
        roles: ['admin'],
        adminRoles: ['admin'],
        defaultRole: 'admin',
        personalExternalIdPrefix: 'custom:',
        getServerConfig,
        getSessionIssuers: () => [],
        webhook: {
          personal: { ownerRole: 'admin', externalIdPrefix: 'different:' },
          getWebhookSecret: () => '',
          isUserSynced: async () => false,
          syncEvent: async () => undefined,
        },
      }),
    ).toThrow('prefixes must match');
    expect(getServerConfig).not.toHaveBeenCalled();
  });

  test('default SDK client and deployment settings initialize only when registering routes', async () => {
    const getServerConfig = mock(() => ({
      clientId: 'client_test',
      apiKey: 'sk_test',
      authkitUrl: 'https://test.authkit.app',
      siteUrl: 'https://test.convex.site',
    }));
    const platforms = createPlatforms({
      role: v.union(v.literal('admin'), v.literal('member')),
      roles: ['admin', 'member'],
      adminRoles: ['admin'],
      defaultRole: 'member',
      getServerConfig,
      getSessionIssuers: () => ['https://api.workos.com/'],
    });
    expect(getServerConfig).not.toHaveBeenCalled();
    platforms.registerRoutes(httpRouter(), manifest);
    expect(getServerConfig).toHaveBeenCalledTimes(1);
  });

  test('first discovery works without generated files and includes only selected or custom native operations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'platforms-integration-'));
    try {
      await mkdir(join(root, 'convex'));
      await symlink(resolve(import.meta.dirname, '../node_modules'), join(root, 'node_modules'));
      await Bun.write(
        join(root, 'convex/platforms.ts'),
        `
import { createPlatforms } from ${JSON.stringify(resolve(import.meta.dirname, '../src/platforms.ts'))};
import { identityFields } from ${JSON.stringify(resolve(import.meta.dirname, '../src/functions.ts'))};
import { v } from 'convex/values';
export const platforms = createPlatforms({ role: v.union(v.literal('admin'), v.literal('member')), roles: ['admin', 'member'], adminRoles: ['admin'], defaultRole: 'member', getClient: () => { throw new Error('Credentials read during discovery'); }, getServerConfig: () => { throw new Error('Settings read during discovery'); }, getSessionIssuers: () => { throw new Error('Issuer read during discovery'); }, resolveIdentity: async () => { throw new Error('Auth during discovery'); } });
export const { listMembers } = platforms.functions;
export const { listMembers: listMembersPublic } = platforms.publicFunctions;
export const getAccount = platforms.internalQuery({ resource: ['account'], platforms: true, args: identityFields, returns: v.string(), handler: () => 'custom' });
`,
      );
      const generated = await generatePlatforms({ root });
      expect(generated.operations.map(({ name }) => name)).toEqual(['getAccount', 'listMembers']);
      expect(generated.operations[0]).toMatchObject({
        function: 'platforms:getAccount',
        path: '/api/v1/account/get',
        outputSchema: { type: 'string' },
      });
      expect(generated.operations[1]).toMatchObject({
        function: 'platforms:listMembers',
        path: '/api/v1/account/members/list',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('registers discovery, authenticated API/MCP routes and the optional signed webhook together', async () => {
    const s = setup();
    const http = httpRouter();
    s.platforms.registerRoutes(http, manifest);
    expect(s.getServerConfig).toHaveBeenCalledTimes(1);
    expect(s.getClient).toHaveBeenCalledTimes(1);
    expect(s.getWebhookSecret).not.toHaveBeenCalled();
    const t = convexTest(defineSchema({}), {
      './_generated/api.ts': async () => ({}),
      './http.ts': async () => ({ default: http }),
    });
    expect((await t.fetch('/api-reference/openapi.json')).status).toBe(200);
    const response = await t.fetch('/api/v1/account/get', { method: 'POST', body: '{}' });
    expect(response.status).toBe(401);
    const mcp = await t.fetch('/mcp', { method: 'POST', body: '{}' });
    expect(mcp.status).toBe(401);
    expect(mcp.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
    expect((await t.fetch('/.well-known/oauth-protected-resource/mcp')).status).toBe(200);
    const payload = JSON.stringify({
      id: 'event_test',
      event: 'user.deleted',
      data: { id: 'user_test' },
      created_at: '2026-01-01',
    });
    const timestamp = Date.now().toString();
    const signature = createHmac('sha256', 'webhook_test_secret')
      .update(`${timestamp}.${payload}`)
      .digest('hex');
    await expect(
      t.fetch('/api/workos/webhook', {
        method: 'POST',
        headers: { 'workos-signature': `t=${timestamp},v1=invalid` },
        body: payload,
      }),
    ).rejects.toThrow('Signature');
    expect(s.syncEvent).not.toHaveBeenCalled();
    expect(
      (
        await t.fetch('/api/workos/webhook', {
          method: 'POST',
          headers: { 'workos-signature': `t=${timestamp},v1=${signature}` },
          body: payload,
        })
      ).status,
    ).toBe(200);
    expect(s.syncEvent).toHaveBeenCalledTimes(1);
  });
});
