import { describe, expect, mock, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { ConflictException, NotFoundException, WorkOS, type Event } from '@workos-inc/node';
import { convexTest } from 'convex-test';
import { defineSchema, httpRouter } from 'convex/server';
import { createWorkOSWebhook } from '../src/workos.js';

const event = {
  id: 'event_one',
  event: 'user.created',
  data: { id: 'user_one' },
  createdAt: '2026-01-01',
} as Event;
const missing = () =>
  new NotFoundException({ path: 'test', requestID: 'request_test', message: 'not found' });
const conflict = () => new ConflictException({ requestID: 'request_test', message: 'already exists' });
const list = (data: unknown[]) => ({ object: 'list', data, listMetadata: { after: null, before: null } });

function setup(personal = true) {
  const provider = {
    webhooks: { constructEvent: mock(async () => event) },
    organizations: {
      getOrganizationByExternalId: mock(async () => ({
        id: 'org_personal',
        externalId: 'personal:user_one',
        name: 'Personal',
      })),
      createOrganization: mock(async () => ({
        id: 'org_personal',
        externalId: 'personal:user_one',
        name: 'Personal',
      })),
    },
    userManagement: {
      getUser: mock(async () => ({ id: 'user_one' })),
      listOrganizationMemberships: mock(async () => list([])),
      createOrganizationMembership: mock(async () => ({ id: 'om_owner' })),
    },
    authorization: {
      getPermission: mock(async () => ({ slug: 'api:access' })),
      createPermission: mock(async () => ({ slug: 'api:access' })),
      getEnvironmentRole: mock(async () => ({ permissions: [] as string[] })),
      addEnvironmentRolePermission: mock(async () => undefined),
    },
  };
  const getClient = mock(() => provider as unknown as WorkOS);
  const getWebhookSecret = mock(() => 'test_webhook_secret');
  const isUserSynced = mock(async () => false);
  const syncEvent = mock(async () => undefined);
  const handler = createWorkOSWebhook({
    getClient,
    getWebhookSecret,
    isUserSynced,
    syncEvent,
    personal: personal ? { ownerRole: 'admin' } : undefined,
  });
  const http = httpRouter();
  http.route({ path: '/workos', method: 'POST', handler });
  const t = convexTest(defineSchema({}), {
    './_generated/api.ts': async () => ({}),
    './http.ts': async () => ({ default: http }),
  });
  const request = () =>
    t.fetch('/workos', {
      method: 'POST',
      headers: { 'workos-signature': 'test_signature' },
      body: 'test_payload',
    });
  return { provider, getClient, getWebhookSecret, isUserSynced, syncEvent, handler, request };
}

describe('signed WorkOS webhook and personal organization provisioning', () => {
  test('registration is lazy, authenticates the raw request and synchronizes after provisioning', async () => {
    const s = setup();
    expect(s.getClient).not.toHaveBeenCalled();
    expect(s.getWebhookSecret).not.toHaveBeenCalled();
    expect(s.handler.isHttp).toBe(true);
    const response = await s.request();
    expect(response.status).toBe(200);
    expect(s.provider.webhooks.constructEvent).toHaveBeenCalledWith({
      payload: 'test_payload',
      sigHeader: 'test_signature',
      secret: 'test_webhook_secret',
    });
    expect(s.provider.authorization.addEnvironmentRolePermission).toHaveBeenCalledWith('admin', {
      permissionSlug: 'api:access',
    });
    expect(s.provider.userManagement.createOrganizationMembership).toHaveBeenCalledWith({
      userId: 'user_one',
      organizationId: 'org_personal',
      roleSlug: 'admin',
    });
    expect(s.syncEvent).toHaveBeenCalledTimes(1);
    expect(s.provider.userManagement.createOrganizationMembership.mock.invocationCallOrder[0]).toBeLessThan(
      s.syncEvent.mock.invocationCallOrder[0]!,
    );
  });
  test('invalid signature does not invoke any provisioning or synchronization callback', async () => {
    const s = setup();
    s.provider.webhooks.constructEvent.mockRejectedValue(new Error('signature rejected'));
    await expect(s.request()).rejects.toThrow('signature rejected');
    expect(s.isUserSynced).not.toHaveBeenCalled();
    expect(s.provider.userManagement.getUser).not.toHaveBeenCalled();
    expect(s.syncEvent).not.toHaveBeenCalled();
  });
  test('deleted users are acknowledged without provisioning or stale synchronization', async () => {
    const s = setup();
    s.provider.userManagement.getUser.mockRejectedValue(missing());
    expect((await s.request()).status).toBe(200);
    expect(s.provider.organizations.getOrganizationByExternalId).not.toHaveBeenCalled();
    expect(s.syncEvent).not.toHaveBeenCalled();
  });
  test('failed provisioning is unacknowledged and never commits synchronization', async () => {
    const s = setup();
    s.provider.organizations.getOrganizationByExternalId.mockRejectedValue(missing());
    s.provider.organizations.createOrganization.mockRejectedValue(
      new Error('provider temporarily unavailable'),
    );
    await expect(s.request()).rejects.toThrow('provider temporarily unavailable');
    expect(s.syncEvent).not.toHaveBeenCalled();
    expect(s.provider.userManagement.createOrganizationMembership).not.toHaveBeenCalled();
  });
  test('organization creation uses a stable external ID and idempotency key', async () => {
    const s = setup();
    s.provider.organizations.getOrganizationByExternalId.mockRejectedValueOnce(missing());
    s.provider.authorization.getPermission.mockRejectedValueOnce(missing());
    await s.request();
    expect(s.provider.organizations.createOrganization).toHaveBeenCalledWith(
      { name: 'Personal', externalId: 'personal:user_one' },
      { idempotencyKey: 'personal:personal:user_one' },
    );
    expect(s.provider.authorization.createPermission).toHaveBeenCalledWith({
      name: 'API access',
      slug: 'api:access',
    });
  });
  test('organization, permission and membership conflicts re-read only their exact scope', async () => {
    const s = setup();
    s.provider.organizations.getOrganizationByExternalId.mockRejectedValueOnce(missing());
    s.provider.organizations.createOrganization.mockRejectedValueOnce(conflict());
    s.provider.authorization.getPermission.mockRejectedValueOnce(missing());
    s.provider.authorization.createPermission.mockRejectedValueOnce(conflict());
    s.provider.userManagement.createOrganizationMembership.mockRejectedValueOnce(conflict());
    s.provider.userManagement.listOrganizationMemberships
      .mockResolvedValueOnce(list([]))
      .mockResolvedValueOnce(list([{ id: 'om_owner', status: 'active' }]));
    expect((await s.request()).status).toBe(200);
    expect(s.provider.organizations.getOrganizationByExternalId.mock.calls).toEqual([
      ['personal:user_one'],
      ['personal:user_one'],
    ]);
    expect(s.provider.authorization.getPermission.mock.calls).toEqual([['api:access'], ['api:access']]);
    expect(s.provider.userManagement.listOrganizationMemberships.mock.calls[1]).toEqual([
      {
        userId: 'user_one',
        organizationId: 'org_personal',
        statuses: ['active', 'inactive', 'pending'],
        limit: 1,
      },
    ]);
    expect(s.syncEvent).toHaveBeenCalledTimes(1);
  });
  test('unconfirmed membership conflict stays unacknowledged', async () => {
    const s = setup();
    s.provider.userManagement.createOrganizationMembership.mockRejectedValue(conflict());
    await expect(s.request()).rejects.toThrow('already exists');
    expect(s.syncEvent).not.toHaveBeenCalled();
  });
  test('existing inactive and pending owner memberships are retained without duplication or reactivation', async () => {
    const s = setup();
    for (const status of ['inactive', 'pending']) {
      s.provider.userManagement.listOrganizationMemberships.mockResolvedValue(
        list([{ id: 'om_owner', status }]),
      );
      expect((await s.request()).status).toBe(200);
    }
    expect(s.provider.userManagement.createOrganizationMembership).not.toHaveBeenCalled();
    expect(s.syncEvent).toHaveBeenCalledTimes(2);
  });
  test('existing role permission avoids repeated writes and verified conflict replay succeeds', async () => {
    const s = setup();
    s.provider.authorization.getEnvironmentRole.mockResolvedValueOnce({ permissions: ['api:access'] });
    await s.request();
    expect(s.provider.authorization.addEnvironmentRolePermission).not.toHaveBeenCalled();
    s.provider.authorization.getEnvironmentRole
      .mockResolvedValueOnce({ permissions: [] })
      .mockResolvedValueOnce({ permissions: ['api:access'] });
    s.provider.authorization.addEnvironmentRolePermission.mockRejectedValueOnce(conflict());
    expect((await s.request()).status).toBe(200);
    expect(s.syncEvent).toHaveBeenCalledTimes(2);
  });
  test('permission conflict without confirmed permission cannot synchronize', async () => {
    const s = setup();
    s.provider.authorization.addEnvironmentRolePermission.mockRejectedValueOnce(conflict());
    await expect(s.request()).rejects.toThrow('already exists');
    expect(s.syncEvent).not.toHaveBeenCalled();
  });
  test('synced users and events without personal provisioning only synchronize', async () => {
    const s = setup();
    s.isUserSynced.mockResolvedValue(true);
    await s.request();
    expect(s.provider.userManagement.getUser).not.toHaveBeenCalled();
    expect(s.syncEvent).toHaveBeenCalledTimes(1);
    const noPersonal = setup(false);
    await noPersonal.request();
    expect(noPersonal.isUserSynced).not.toHaveBeenCalled();
    expect(noPersonal.provider.userManagement.getUser).not.toHaveBeenCalled();
    expect(noPersonal.syncEvent).toHaveBeenCalledTimes(1);
  });
  test('official SDK rejects invalid HMAC and accepts an authentic signed event offline', async () => {
    const workos = new WorkOS('sk_test_offline', { clientId: 'client_test' });
    const secret = 'whsec_offline_test';
    const syncEvent = mock(async () => undefined);
    const isUserSynced = mock(async () => true);
    const http = httpRouter();
    http.route({
      path: '/workos',
      method: 'POST',
      handler: createWorkOSWebhook({
        getClient: () => workos,
        getWebhookSecret: () => secret,
        isUserSynced,
        syncEvent,
      }),
    });
    const t = convexTest(defineSchema({}), {
      './_generated/api.ts': async () => ({}),
      './http.ts': async () => ({ default: http }),
    });
    const payload = JSON.stringify({
      id: 'event_one',
      event: 'user.updated',
      created_at: '2026-01-01',
      data: {
        object: 'user',
        id: 'user_one',
        email: 'offline@example.test',
        email_verified: true,
        first_name: null,
        last_name: null,
        profile_picture_url: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    });
    const timestamp = Date.now().toString();
    const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
    await expect(
      t.fetch('/workos', {
        method: 'POST',
        headers: { 'workos-signature': `t=${timestamp},v1=invalid` },
        body: payload,
      }),
    ).rejects.toThrow('Signature');
    expect(syncEvent).not.toHaveBeenCalled();
    const response = await t.fetch('/workos', {
      method: 'POST',
      headers: { 'workos-signature': `t=${timestamp},v1=${signature}` },
      body: payload,
    });
    expect(response.status).toBe(200);
    expect(syncEvent).toHaveBeenCalledTimes(1);
  });
});
