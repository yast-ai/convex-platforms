import { describe, expect, mock, test } from 'bun:test';
import {
  ConflictException,
  type OrganizationMembership,
  type UserApiKey,
  type WorkOS,
} from '@workos-inc/node';
import { convexTest } from 'convex-test';
import { defineSchema, makeFunctionReference } from 'convex/server';
import { v } from 'convex/values';
import { createWorkOSFunctions } from '../src/workos.js';

const identity = { orgId: 'org_one', userId: 'user_owner', role: 'admin' as const };
const session = { issuer: 'https://api.workos.com/', subject: identity.userId, org_id: identity.orgId };
const role = v.union(v.literal('admin'), v.literal('member'));
const page = <T>(data: T[], after: string | null = null) => ({
  object: 'list' as const,
  data,
  listMetadata: { before: null, after },
});
const membership = (fields: Partial<OrganizationMembership> = {}) =>
  ({
    id: 'om_other',
    userId: 'user_other',
    organizationId: 'org_one',
    status: 'active',
    role: { slug: 'member' },
    ...fields,
  }) as OrganizationMembership;
const invite = {
  id: 'inv_one',
  email: 'invite@example.test',
  organizationId: 'org_one',
  state: 'pending' as const,
  expiresAt: '2026-12-01',
};
const key = (fields: Partial<UserApiKey> = {}) =>
  ({
    id: 'key_one',
    name: 'development',
    obfuscatedValue: 'sk_...123',
    lastUsedAt: null,
    createdAt: '2026-01-01',
    owner: { id: 'user_owner', organizationId: 'org_one' },
    ...fields,
  }) as UserApiKey;

function setup() {
  const provider = {
    organizations: {
      getOrganization: mock(async (orgId: string) => ({ id: orgId, name: 'Team', externalId: null })),
      updateOrganization: mock(async ({ organization, name }: { organization: string; name: string }) => ({
        id: organization,
        name,
      })),
      createOrganization: mock(async () => ({ id: 'org_new', name: 'New team' })),
    },
    userManagement: {
      listOrganizationMemberships: mock(async () => page([membership()])),
      getOrganizationMembership: mock(async () => membership()),
      updateOrganizationMembership: mock(async (_id: string, options: { roleSlug: string }) =>
        membership({ role: { slug: options.roleSlug } }),
      ),
      deleteOrganizationMembership: mock(async () => undefined),
      createOrganizationMembership: mock(async () =>
        membership({
          id: 'om_new',
          userId: identity.userId,
          organizationId: 'org_new',
          role: { slug: 'admin' },
        }),
      ),
      listInvitations: mock(async () => page([invite])),
      getInvitation: mock(async () => invite),
      sendInvitation: mock(async (options: { email: string }) => ({ ...invite, email: options.email })),
      resendInvitation: mock(async () => invite),
      revokeInvitation: mock(async () => ({ ...invite, state: 'revoked' })),
      listUserApiKeys: mock(async () => page([key()])),
      createUserApiKey: mock(async () => ({ ...key(), value: 'secret-once' })),
    },
    apiKeys: { deleteApiKey: mock(async () => undefined) },
  };
  const getClient = mock(() => provider as unknown as WorkOS);
  const getSessionIssuers = mock(() => [
    'https://api.workos.com/',
    'https://api.workos.com/user_management/client_test',
  ]);
  const resolveIdentity = mock(async (ctx: { auth: { getUserIdentity: () => Promise<unknown> } }) => {
    if (!(await ctx.auth.getUserIdentity())) throw new Error('unauthenticated');
    return identity;
  });
  const functions = createWorkOSFunctions({
    role,
    roles: ['admin', 'member'],
    adminRoles: ['admin'],
    defaultRole: 'member',
    getClient,
    getSessionIssuers,
    resolveIdentity,
  });
  const internal = Object.assign(
    {},
    functions.account,
    functions.members,
    functions.invitations,
    functions.apiKeys,
    functions.teams,
  );
  const publicFunctions = Object.assign({}, ...Object.values(functions.public));
  const t = convexTest(defineSchema({}), {
    './_generated/api.ts': async () => ({}),
    './workos/internal.ts': async () => internal,
    './workos/index.ts': async () => publicFunctions,
  });
  const action = (name: string, args: Record<string, unknown> = {}, authenticated = false) =>
    (authenticated ? t.withIdentity(session) : t).action(
      makeFunctionReference<'action'>(`workos/internal:${name}`),
      { ...identity, ...args },
    );
  return { provider, getClient, getSessionIssuers, functions, t, action, resolveIdentity };
}

describe('reusable native WorkOS operations', () => {
  test('discovery is lazy, visibility and role validators stay native', async () => {
    const s = setup();
    expect(s.getClient).not.toHaveBeenCalled();
    expect(s.getSessionIssuers).not.toHaveBeenCalled();
    expect(Object.keys(s.functions.functions)).toHaveLength(14);
    expect(Object.keys(s.functions.publicFunctions)).toHaveLength(14);
    expect(s.functions.functions.getAccount).toBe(s.functions.account.getAccount);
    expect(s.functions.publicFunctions.getAccount).toBe(s.functions.public.account.getAccount);
    expect(s.functions.account.getAccount.isQuery).toBe(true);
    expect(s.functions.account.getAccount.isInternal).toBe(true);
    expect(s.functions.public.account.getAccount.isPublic).toBe(true);
    expect(
      (s.functions.public.account.getAccount as unknown as { platforms?: unknown }).platforms,
    ).toBeUndefined();
    expect(await s.t.query(makeFunctionReference<'query'>('workos/internal:getAccount'), identity)).toEqual(
      identity,
    );
    await expect(
      s.action('listMembers', { role: 'owner', paginationOpts: { numItems: 10, cursor: null } }),
    ).rejects.toThrow();
    expect(s.getClient).not.toHaveBeenCalled();
  });
  test('public wrappers authenticate first, strip identity fields and share internal behavior', async () => {
    const s = setup();
    const ref = makeFunctionReference<'action'>('workos/index:updateAccount');
    await expect(s.t.action(ref, { name: 'Team' })).rejects.toThrow('unauthenticated');
    expect(s.getClient).not.toHaveBeenCalled();
    await expect(
      s.t.withIdentity(session).action(ref, { orgId: 'org_attacker', name: 'Team' }),
    ).rejects.toThrow();
    expect(s.getClient).not.toHaveBeenCalled();
    const result = await s.t.withIdentity(session).action(ref, { name: ' New team ' });
    expect(result).toEqual({ id: identity.orgId, name: 'New team', personal: false, role: 'admin' });
    expect(s.provider.organizations.updateOrganization).toHaveBeenCalledWith({
      organization: identity.orgId,
      name: 'New team',
    });
  });
  test('all administrative mutations reject members before touching WorkOS', async () => {
    const s = setup();
    for (const [name, args] of [
      ['updateAccount', { name: 'Team' }],
      ['updateMemberRole', { membershipId: 'om_other', roleSlug: 'admin' }],
      ['removeMember', { membershipId: 'om_other' }],
      ['listInvitations', { paginationOpts: { numItems: 10, cursor: null } }],
      ['sendInvitation', { email: 'a@example.test' }],
      ['resendInvitation', { invitationId: invite.id }],
      ['revokeInvitation', { invitationId: invite.id }],
    ] as const)
      await expect(s.action(name, { ...args, role: 'member' })).rejects.toThrow('forbidden');
    expect(s.getClient).not.toHaveBeenCalled();
  });
  test('names and session-only create operations fail before provider access', async () => {
    const s = setup();
    await expect(s.action('updateAccount', { name: ' '.repeat(10) })).rejects.toThrow('invalid_name');
    await expect(s.action('createApiKey', { name: 'key' })).rejects.toThrow('session_required');
    await expect(s.action('createTeam', { name: 'team', requestId: crypto.randomUUID() })).rejects.toThrow(
      'session_required',
    );
    await expect(s.action('createApiKey', { name: ' '.repeat(10) }, true)).rejects.toThrow('invalid_name');
    await expect(s.action('createTeam', { name: 'team', requestId: 'invalid' }, true)).rejects.toThrow(
      'invalid_request_id',
    );
    expect(s.getClient).not.toHaveBeenCalled();
  });
  test('rejects Connect, wrong issuer, cross-user and cross-org sessions', async () => {
    const s = setup();
    for (const altered of [
      { issuer: 'https://connect.example.test' },
      { issuer: 'https://api.workos.com' },
      { subject: 'user_attacker' },
      { org_id: 'org_attacker' },
    ]) {
      const t = s.t.withIdentity({ ...session, ...altered });
      for (const [name, args] of [
        ['createApiKey', { name: 'key' }],
        ['createTeam', { name: 'team', requestId: crypto.randomUUID() }],
      ] as const)
        await expect(
          t.action(makeFunctionReference<'action'>(`workos/internal:${name}`), { ...identity, ...args }),
        ).rejects.toThrow('session_required');
    }
    expect(s.getClient).not.toHaveBeenCalled();
  });
  test('creates API key with exactly api:access and returns secret only on creation', async () => {
    const s = setup();
    const result = await s.action('createApiKey', { name: ' Development ' }, true);
    expect(result.value).toBe('secret-once');
    expect(s.provider.userManagement.createUserApiKey).toHaveBeenCalledWith(identity.userId, {
      name: 'Development',
      organizationId: identity.orgId,
      permissions: ['api:access'],
    });
    const list = await s.action('listApiKeys', { paginationOpts: { numItems: 10, cursor: null } });
    expect(list.page[0]).not.toHaveProperty('value');
    expect(list.page[0]).not.toHaveProperty('owner');
  });
  test('translates native pagination, rejects unsupported options and returns configured roles', async () => {
    const s = setup();
    s.provider.userManagement.listOrganizationMemberships.mockResolvedValue(
      page([membership({ roles: [{ slug: 'member' }, { slug: 'admin' }] })], 'cursor_next'),
    );
    const result = await s.action('listMembers', { paginationOpts: { numItems: 7, cursor: 'cursor_start' } });
    expect(result).toEqual({
      page: [{ id: 'om_other', userId: 'user_other', role: 'admin' }],
      isDone: false,
      continueCursor: 'cursor_next',
    });
    expect(s.provider.userManagement.listOrganizationMemberships).toHaveBeenCalledWith({
      organizationId: identity.orgId,
      statuses: ['active'],
      limit: 7,
      after: 'cursor_start',
    });
    const count = s.provider.userManagement.listOrganizationMemberships.mock.calls.length;
    for (const opts of [
      { numItems: 0, cursor: null },
      { numItems: 101, cursor: null },
      { numItems: 1.5, cursor: null },
      { numItems: 10, cursor: null, endCursor: 'end' },
      { numItems: 10, cursor: null, maximumRowsRead: 10 },
    ])
      await expect(s.action('listMembers', { paginationOpts: opts })).rejects.toThrow();
    expect(s.provider.userManagement.listOrganizationMemberships.mock.calls.length).toBe(count);
  });
  test('blocks personal account edits, self-removal, directory members and foreign memberships', async () => {
    const s = setup();
    s.provider.organizations.getOrganization.mockResolvedValue({
      id: 'org_one',
      name: 'Personal',
      externalId: 'personal:user_owner',
    });
    await expect(s.action('updateAccount', { name: 'Renamed' })).rejects.toThrow('personal_account');
    await expect(s.action('removeMember', { membershipId: 'om_other' })).rejects.toThrow('personal_account');
    s.provider.organizations.getOrganization.mockResolvedValue({
      id: 'org_one',
      name: 'Team',
      externalId: null,
    });
    for (const override of [
      { userId: identity.userId },
      { directoryManaged: true },
      { organizationId: 'org_foreign' },
      { status: 'inactive' as const },
    ]) {
      s.provider.userManagement.getOrganizationMembership.mockResolvedValue(membership(override));
      await expect(s.action('removeMember', { membershipId: 'om_other' })).rejects.toThrow();
      await expect(
        s.action('updateMemberRole', { membershipId: 'om_other', roleSlug: 'admin' }),
      ).rejects.toThrow();
    }
    expect(s.provider.userManagement.deleteOrganizationMembership).not.toHaveBeenCalled();
    expect(s.provider.userManagement.updateOrganizationMembership).not.toHaveBeenCalled();
  });
  test('member mutation and invitation projections preserve exact contracts', async () => {
    const s = setup();
    expect(await s.action('updateMemberRole', { membershipId: 'om_other', roleSlug: 'admin' })).toEqual({
      id: 'om_other',
      userId: 'user_other',
      role: 'admin',
    });
    expect(await s.action('removeMember', { membershipId: 'om_other' })).toBeNull();
    expect(
      (await s.action('listInvitations', { paginationOpts: { numItems: 10, cursor: null } })).page[0],
    ).toEqual({ id: invite.id, email: invite.email, state: invite.state, expiresAt: invite.expiresAt });
    expect(await s.action('sendInvitation', { email: ' INVITE@EXAMPLE.TEST ' })).toEqual({
      id: invite.id,
      email: invite.email,
      state: invite.state,
      expiresAt: invite.expiresAt,
    });
    expect(s.provider.userManagement.sendInvitation).toHaveBeenCalledWith({
      email: invite.email,
      roleSlug: 'member',
      organizationId: identity.orgId,
      inviterUserId: identity.userId,
    });
    expect((await s.action('resendInvitation', { invitationId: invite.id })).state).toBe('pending');
    expect((await s.action('revokeInvitation', { invitationId: invite.id })).state).toBe('revoked');
  });
  test('foreign or non-pending invitations cannot be resent or revoked', async () => {
    const s = setup();
    for (const changed of [{ organizationId: 'org_foreign' }, { state: 'expired' }]) {
      s.provider.userManagement.getInvitation.mockResolvedValue({ ...invite, ...changed } as typeof invite);
      await expect(s.action('resendInvitation', { invitationId: invite.id })).rejects.toThrow();
      await expect(s.action('revokeInvitation', { invitationId: invite.id })).rejects.toThrow();
    }
    expect(s.provider.userManagement.resendInvitation).not.toHaveBeenCalled();
    expect(s.provider.userManagement.revokeInvitation).not.toHaveBeenCalled();
    await expect(s.action('sendInvitation', { email: 'invalid' })).rejects.toThrow('invalid_email');
    expect(s.provider.userManagement.sendInvitation).not.toHaveBeenCalled();
  });
  test('API-key revocation scans scoped pages and verifies returned owner', async () => {
    const s = setup();
    s.provider.userManagement.listUserApiKeys
      .mockResolvedValueOnce(page([], 'next'))
      .mockResolvedValueOnce(page([key()]));
    expect(await s.action('revokeApiKey', { apiKeyId: 'key_one' })).toBeNull();
    expect(s.provider.userManagement.listUserApiKeys.mock.calls[1]).toEqual([
      identity.userId,
      { organizationId: identity.orgId, limit: 100, after: 'next' },
    ]);
    expect(s.provider.apiKeys.deleteApiKey).toHaveBeenCalledWith('key_one');
    for (const owner of [
      { id: 'user_attacker', organizationId: identity.orgId },
      { id: identity.userId, organizationId: 'org_foreign' },
    ]) {
      s.provider.userManagement.listUserApiKeys.mockResolvedValue(
        page([key({ owner: owner as UserApiKey['owner'] })]),
      );
      await expect(s.action('revokeApiKey', { apiKeyId: 'key_one' })).rejects.toThrow('not_found');
    }
    expect(s.provider.apiKeys.deleteApiKey.mock.calls).toHaveLength(1);
    s.provider.userManagement.listUserApiKeys.mockResolvedValue(page([], 'repeat'));
    await expect(s.action('revokeApiKey', { apiKeyId: 'missing' })).rejects.toThrow(
      'invalid_provider_cursor',
    );
  });
  test('teams list active memberships and protect personal organization ownership', async () => {
    const s = setup();
    const result = await s.action('listTeams', { paginationOpts: { numItems: 10, cursor: null } });
    expect(result.page).toEqual([{ id: 'org_one', name: 'Team', personal: false, role: 'member' }]);
    expect(s.provider.userManagement.listOrganizationMemberships).toHaveBeenCalledWith({
      userId: identity.userId,
      statuses: ['active'],
      limit: 10,
      after: undefined,
    });
    s.provider.organizations.getOrganization.mockResolvedValue({
      id: 'org_one',
      name: 'Personal',
      externalId: 'personal:user_owner',
    });
    await expect(s.action('listTeams', { paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow(
      'forbidden',
    );
  });
  test('team create retries use the same organization key and reuse owner membership', async () => {
    const s = setup();
    const args = { name: ' New team ', requestId: crypto.randomUUID() };
    s.provider.userManagement.listOrganizationMemberships
      .mockResolvedValueOnce(page([]))
      .mockResolvedValue(
        page([membership({ userId: identity.userId, organizationId: 'org_new', role: { slug: 'admin' } })]),
      );
    expect(await s.action('createTeam', args, true)).toEqual({
      id: 'org_new',
      name: 'New team',
      personal: false,
      role: 'admin',
    });
    await s.action('createTeam', args, true);
    expect(s.provider.organizations.createOrganization.mock.calls[0]).toEqual([
      { name: 'New team' },
      { idempotencyKey: `team:${identity.userId}:${args.requestId}` },
    ]);
    expect(s.provider.organizations.createOrganization.mock.calls[1]).toEqual(
      s.provider.organizations.createOrganization.mock.calls[0],
    );
    expect(s.provider.userManagement.createOrganizationMembership).toHaveBeenCalledTimes(1);
  });
  test('team create resolves a membership race only after scoped conflict lookup', async () => {
    const s = setup();
    s.provider.userManagement.listOrganizationMemberships
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(
        page([membership({ userId: identity.userId, organizationId: 'org_new', role: { slug: 'admin' } })]),
      );
    s.provider.userManagement.createOrganizationMembership.mockRejectedValueOnce(
      new ConflictException({ requestID: 'request_test', message: 'duplicate' }),
    );
    const result = await s.action('createTeam', { name: 'New team', requestId: crypto.randomUUID() }, true);
    expect(result.role).toBe('admin');
    expect(s.provider.userManagement.listOrganizationMemberships.mock.calls[1]).toEqual([
      {
        userId: identity.userId,
        organizationId: 'org_new',
        statuses: ['active', 'inactive', 'pending'],
        limit: 1,
      },
    ]);
  });
  test('team create cannot return foreign, inactive or non-owner memberships', async () => {
    const s = setup();
    for (const changed of [
      { userId: 'user_other' },
      { organizationId: 'org_foreign' },
      { status: 'inactive' as const },
      { role: { slug: 'member' } },
    ]) {
      s.provider.userManagement.listOrganizationMemberships.mockResolvedValue(
        page([
          membership({
            userId: identity.userId,
            organizationId: 'org_new',
            role: { slug: 'admin' },
            ...changed,
          }),
        ]),
      );
      await expect(
        s.action('createTeam', { name: 'New team', requestId: crypto.randomUUID() }, true),
      ).rejects.toThrow();
    }
    expect(s.provider.userManagement.createOrganizationMembership).not.toHaveBeenCalled();
  });
  test('consumer allowlists cannot turn a Connect issuer into a first-party session', async () => {
    const s = setup();
    s.getSessionIssuers.mockReturnValue(['https://connect.example.test']);
    await expect(
      s.t
        .withIdentity({ ...session, issuer: 'https://connect.example.test' })
        .action(makeFunctionReference<'action'>('workos/internal:createApiKey'), {
          ...identity,
          name: 'key',
        }),
    ).rejects.toThrow('session_required');
    expect(s.getClient).not.toHaveBeenCalled();
    s.getSessionIssuers.mockReturnValue(['https://api.workos.com/user_management/client_test']);
    expect(
      (
        await s.t
          .withIdentity({ ...session, issuer: 'https://api.workos.com/user_management/client_test' })
          .action(makeFunctionReference<'action'>('workos/internal:createApiKey'), {
            ...identity,
            name: 'key',
          })
      ).value,
    ).toBe('secret-once');
  });
  test('configured role policy blocks unlisted roles even with a broad string validator', async () => {
    const s = setup();
    const functions = createWorkOSFunctions({
      role: v.string(),
      roles: ['admin', 'member'],
      adminRoles: ['admin'],
      defaultRole: 'member',
      getClient: s.getClient,
      getSessionIssuers: s.getSessionIssuers,
      resolveIdentity: s.resolveIdentity,
    });
    const t = convexTest(defineSchema({}), {
      './_generated/api.ts': async () => ({}),
      './workos/actions.ts': async () => ({ ...functions.members, ...functions.invitations }),
    });
    for (const [name, args] of [
      ['updateMemberRole', { membershipId: 'om_other', roleSlug: 'superuser' }],
      ['sendInvitation', { email: 'a@example.test', roleSlug: 'superuser' }],
    ] as const)
      await expect(
        t.action(makeFunctionReference<'action'>(`workos/actions:${name}`), { ...identity, ...args }),
      ).rejects.toThrow('role_required');
    expect(s.getClient).not.toHaveBeenCalled();
  });
  test('custom roles and personal prefixes require consistent policy', () => {
    const s = setup();
    const options = {
      role: v.union(v.literal('owner'), v.literal('viewer')),
      roles: ['owner', 'viewer'] as const,
      adminRoles: ['owner'] as const,
      defaultRole: 'viewer' as const,
      getClient: s.getClient,
      getSessionIssuers: s.getSessionIssuers,
      resolveIdentity: async () => ({ ...identity, role: 'owner' as const }),
      personalExternalIdPrefix: 'private:',
    };
    const functions = createWorkOSFunctions(options);
    expect(
      JSON.parse(functions.members.updateMemberRole.exportArgs()).value.roleSlug.fieldType.value.map(
        (entry: { value: string }) => entry.value,
      ),
    ).toEqual(['owner', 'viewer']);
    expect(() => createWorkOSFunctions({ ...options, roles: ['viewer'] })).toThrow('configured consistently');
    expect(() => createWorkOSFunctions({ ...options, personalExternalIdPrefix: '' })).toThrow(
      'configured consistently',
    );
    expect(s.getClient).not.toHaveBeenCalled();
  });
});
