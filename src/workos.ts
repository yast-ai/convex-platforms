import {
  ConflictException,
  type Invitation,
  type Organization,
  type OrganizationMembership,
  type UserApiKey,
  type WorkOS,
} from '@workos-inc/node';
import {
  actionGeneric,
  queryGeneric,
  type GenericQueryCtx,
  type GenericActionCtx,
  type GenericDataModel,
} from 'convex/server';
import {
  ConvexError,
  v,
  type Validator,
  type GenericValidator,
  type PropertyValidators,
  type ObjectType,
  type Infer,
} from 'convex/values';
import type { Platforms } from './contract.js';
import { createPlatformFunctions } from './functions.js';
import { createWorkOSValidators } from './workos-validators.js';
import { paginateWorkOS } from './workos-pagination.js';
export { createWorkOSValidators } from './workos-validators.js';

export type WorkOSFunctionsConfig<Role extends string> = {
  role: Validator<Role, 'required', string>;
  /** Highest priority first when a membership has multiple roles. */
  roles: readonly NoInfer<Role>[];
  adminRoles: readonly NoInfer<Role>[];
  defaultRole: NoInfer<Role>;
  /** Lazy access keeps credentials and environment reads out of discovery. */
  getClient: () => WorkOS;
  /** Application authentication. Never accept identity fields from operation arguments. */
  resolveIdentity: (
    ctx: Pick<GenericQueryCtx<GenericDataModel>, 'auth'>,
  ) => Promise<{ orgId: string; userId: string; role: NoInfer<Role> }>;
  /** Exact trusted web/device issuers. Never include a WorkOS Connect issuer. */
  getSessionIssuers: () => readonly string[];
  personalExternalIdPrefix?: string;
  platforms?: Platforms;
};

/** Native internal operations. Only trusted authenticated callers may supply identity fields. */
export function createWorkOSFunctions<Role extends string>(config: WorkOSFunctionsConfig<Role>) {
  const schemas = createWorkOSValidators(config.role);
  const {
    identityFields,
    account,
    member,
    invitation,
    apiKeyCreated,
    pagination,
    accountPage,
    memberPage,
    invitationPage,
    apiKeyPage,
  } = schemas;
  const builders = createPlatformFunctions<GenericDataModel>();
  type Definition<Ctx, A extends PropertyValidators, R extends GenericValidator> = {
    platforms?: Platforms;
    args: A;
    returns: R;
    handler: (ctx: Ctx, args: ObjectType<A>) => Infer<R> | Promise<Infer<R>>;
  };
  const publicArgs = <A extends PropertyValidators>(args: A): Omit<A, 'orgId' | 'userId' | 'role'> => {
    const { orgId, userId, role, ...operationArgs } = args;
    void orgId;
    void userId;
    void role;
    return operationArgs;
  };
  const internalAction = <A extends PropertyValidators, R extends GenericValidator>(
    definition: Definition<GenericActionCtx<GenericDataModel>, A, R>,
  ) => ({
    internal: builders.internalAction(definition),
    public: actionGeneric({
      args: publicArgs(definition.args),
      returns: definition.returns,
      handler: async (ctx, args) => {
        const identity = await config.resolveIdentity(ctx);
        return definition.handler(ctx, { ...identity, ...args } as ObjectType<A>);
      },
    }),
  });
  const internalQuery = <A extends PropertyValidators, R extends GenericValidator>(
    definition: Definition<GenericQueryCtx<GenericDataModel>, A, R>,
  ) => ({
    internal: builders.internalQuery(definition),
    public: queryGeneric({
      args: publicArgs(definition.args),
      returns: definition.returns,
      handler: async (ctx, args) => {
        const identity = await config.resolveIdentity(ctx);
        return definition.handler(ctx, { ...identity, ...args } as ObjectType<A>);
      },
    }),
  });
  const rolePriority = [...config.roles];
  const adminRoles = [...config.adminRoles];
  const defaultRole = config.defaultRole;
  const personalPrefix = config.personalExternalIdPrefix ?? 'personal:';
  if (
    !rolePriority.length ||
    !adminRoles.length ||
    new Set(rolePriority).size !== rolePriority.length ||
    !rolePriority.includes(defaultRole) ||
    adminRoles.some((role) => !rolePriority.includes(role)) ||
    !personalPrefix
  )
    throw new Error(
      'WorkOS roles, administrative roles, default role and personal prefix must be configured consistently.',
    );
  const platforms = config.platforms ?? true;
  const assertRole = (role: Role) => {
    if (!rolePriority.includes(role)) throw new ConvexError({ code: 'role_required', status: 403 });
  };
  const assertAdmin = (role: Role) => {
    if (!adminRoles.includes(role)) throw new ConvexError({ code: 'forbidden', status: 403 });
  };
  const membershipRole = (membership: OrganizationMembership): Role => {
    const slugs = (membership.roles ?? [membership.role]).map((role) => role.slug);
    const role = rolePriority.find((role) => slugs.includes(role));
    if (!role) throw new ConvexError({ code: 'role_required', status: 403 });
    return role;
  };
  const requireSession = async (
    ctx: Pick<GenericActionCtx<GenericDataModel>, 'auth'>,
    args: { orgId: string; userId: string },
  ) => {
    const identity = await ctx.auth.getUserIdentity().catch(() => null);
    const firstPartyIssuer =
      identity?.issuer === 'https://api.workos.com/' ||
      /^https:\/\/api\.workos\.com\/user_management\/client_[A-Za-z0-9_]+$/.test(identity?.issuer ?? '');
    if (
      !identity ||
      !firstPartyIssuer ||
      !config.getSessionIssuers().includes(identity.issuer) ||
      identity.subject !== args.userId ||
      identity.org_id !== args.orgId
    )
      throw new ConvexError({ code: 'session_required', status: 403 });
  };
  const requireTeam = async (workos: WorkOS, orgId: string) => {
    const org = await workos.organizations.getOrganization(orgId);
    if (org.externalId?.startsWith(personalPrefix))
      throw new ConvexError({ code: 'personal_account', status: 403 });
    return org;
  };
  const accountResult = async (
    workos: WorkOS,
    membership: OrganizationMembership,
    organization?: Organization,
  ) => {
    if (membership.status !== 'active') throw new ConvexError({ code: 'forbidden', status: 403 });
    const role = membershipRole(membership);
    const org = organization ?? (await workos.organizations.getOrganization(membership.organizationId));
    if (membership.organizationId !== org.id) throw new ConvexError({ code: 'forbidden', status: 403 });
    const personal = org.externalId?.startsWith(personalPrefix) ?? false;
    if (personal && org.externalId !== `${personalPrefix}${membership.userId}`)
      throw new ConvexError({ code: 'forbidden', status: 403 });
    return { id: org.id, name: org.name, personal, role };
  };
  const memberResult = (membership: OrganizationMembership) => ({
    id: membership.id,
    userId: membership.userId,
    role: membershipRole(membership),
  });
  const invitationResult = (invite: Invitation) => ({
    id: invite.id,
    email: invite.email,
    state: invite.state,
    expiresAt: invite.expiresAt,
  });
  const keyResult = (key: UserApiKey) => ({
    id: key.id,
    name: key.name,
    obfuscatedValue: key.obfuscatedValue,
    lastUsedAt: key.lastUsedAt,
    createdAt: key.createdAt,
  });
  const validName = (input: string) => {
    const name = input.trim();
    if (!name || name.length > 100) throw new ConvexError({ code: 'invalid_name', status: 400 });
    return name;
  };
  const requireMember = async (workos: WorkOS, orgId: string, userId: string, membershipId: string) => {
    const membership = await workos.userManagement.getOrganizationMembership(membershipId);
    if (membership.organizationId !== orgId || membership.status !== 'active')
      throw new ConvexError({ code: 'not_found', status: 404 });
    if (membership.userId === userId)
      throw new ConvexError({ code: 'admin_membership_protected', status: 403 });
    if (membership.directoryManaged) throw new ConvexError({ code: 'directory_managed', status: 403 });
    return membership;
  };
  const requirePendingInvitation = async (workos: WorkOS, orgId: string, invitationId: string) => {
    const invite = await workos.userManagement.getInvitation(invitationId);
    if (invite.organizationId !== orgId) throw new ConvexError({ code: 'not_found', status: 404 });
    if (invite.state !== 'pending') throw new ConvexError({ code: 'invitation_not_pending', status: 400 });
    return invite;
  };
  const operations = {
    account: {
      getAccount: internalQuery({
        platforms,
        args: identityFields,
        returns: v.object(identityFields),
        handler: (_ctx, { orgId, userId, role }) => ({ orgId, userId, role }),
      }),
      updateAccount: internalAction({
        platforms,
        args: { ...identityFields, name: v.string() },
        returns: account,
        handler: async (_ctx, { orgId, role, name }) => {
          assertAdmin(role);
          name = validName(name);
          const workos = config.getClient();
          await requireTeam(workos, orgId);
          const org = await workos.organizations.updateOrganization({ organization: orgId, name });
          return { id: org.id, name: org.name, personal: false, role };
        },
      }),
    },
    members: {
      listMembers: internalAction({
        platforms,
        args: { ...identityFields, ...pagination.fields },
        returns: memberPage,
        handler: async (_ctx, { orgId, paginationOpts }) => {
          const result = await paginateWorkOS(paginationOpts, (opts) =>
            config.getClient().userManagement.listOrganizationMemberships({
              organizationId: orgId,
              statuses: ['active'],
              ...opts,
            }),
          );
          return { ...result, page: result.page.map(memberResult) };
        },
      }),
      updateMemberRole: internalAction({
        platforms,
        args: { ...identityFields, membershipId: v.string(), roleSlug: config.role },
        returns: member,
        handler: async (_ctx, { orgId, userId, role, membershipId, roleSlug }) => {
          assertAdmin(role);
          assertRole(roleSlug);
          const workos = config.getClient();
          await requireTeam(workos, orgId);
          const membership = await requireMember(workos, orgId, userId, membershipId);
          return memberResult(
            await workos.userManagement.updateOrganizationMembership(membership.id, { roleSlug }),
          );
        },
      }),
      removeMember: internalAction({
        platforms,
        args: { ...identityFields, membershipId: v.string() },
        returns: v.null(),
        handler: async (_ctx, { orgId, userId, role, membershipId }) => {
          assertAdmin(role);
          const workos = config.getClient();
          await requireTeam(workos, orgId);
          const membership = await requireMember(workos, orgId, userId, membershipId);
          await workos.userManagement.deleteOrganizationMembership(membership.id);
          return null;
        },
      }),
    },
    invitations: {
      listInvitations: internalAction({
        platforms,
        args: { ...identityFields, ...pagination.fields },
        returns: invitationPage,
        handler: async (_ctx, { orgId, role, paginationOpts }) => {
          assertAdmin(role);
          const workos = config.getClient();
          await requireTeam(workos, orgId);
          const result = await paginateWorkOS(paginationOpts, (opts) =>
            workos.userManagement.listInvitations({ organizationId: orgId, ...opts }),
          );
          return { ...result, page: result.page.map(invitationResult) };
        },
      }),
      sendInvitation: internalAction({
        platforms,
        args: { ...identityFields, email: v.string(), roleSlug: v.optional(config.role) },
        returns: invitation,
        handler: async (_ctx, { orgId, userId, role, email, roleSlug }) => {
          assertAdmin(role);
          assertRole(roleSlug ?? defaultRole);
          const workos = config.getClient();
          await requireTeam(workos, orgId);
          email = email.trim().toLowerCase();
          if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            throw new ConvexError({ code: 'invalid_email', status: 400 });
          return invitationResult(
            await workos.userManagement.sendInvitation({
              email,
              roleSlug: roleSlug ?? defaultRole,
              organizationId: orgId,
              inviterUserId: userId,
            }),
          );
        },
      }),
      resendInvitation: internalAction({
        platforms,
        args: { ...identityFields, invitationId: v.string() },
        returns: invitation,
        handler: async (_ctx, { orgId, role, invitationId }) => {
          assertAdmin(role);
          const workos = config.getClient();
          await requireTeam(workos, orgId);
          await requirePendingInvitation(workos, orgId, invitationId);
          return invitationResult(await workos.userManagement.resendInvitation(invitationId));
        },
      }),
      revokeInvitation: internalAction({
        platforms,
        args: { ...identityFields, invitationId: v.string() },
        returns: invitation,
        handler: async (_ctx, { orgId, role, invitationId }) => {
          assertAdmin(role);
          const workos = config.getClient();
          await requireTeam(workos, orgId);
          await requirePendingInvitation(workos, orgId, invitationId);
          return invitationResult(await workos.userManagement.revokeInvitation(invitationId));
        },
      }),
    },
    apiKeys: {
      listApiKeys: internalAction({
        platforms,
        args: { ...identityFields, ...pagination.fields },
        returns: apiKeyPage,
        handler: async (_ctx, { orgId, userId, paginationOpts }) => {
          const result = await paginateWorkOS(paginationOpts, (opts) =>
            config.getClient().userManagement.listUserApiKeys(userId, { organizationId: orgId, ...opts }),
          );
          return { ...result, page: result.page.map(keyResult) };
        },
      }),
      createApiKey: internalAction({
        platforms,
        args: { ...identityFields, name: v.string() },
        returns: apiKeyCreated,
        handler: async (ctx, { orgId, userId, name }) => {
          await requireSession(ctx, { orgId, userId });
          name = validName(name);
          const key = await config.getClient().userManagement.createUserApiKey(userId, {
            name,
            organizationId: orgId,
            permissions: ['api:access'],
          });
          return { ...keyResult(key), value: key.value };
        },
      }),
      revokeApiKey: internalAction({
        platforms,
        args: { ...identityFields, apiKeyId: v.string() },
        returns: v.null(),
        handler: async (_ctx, { orgId, userId, apiKeyId }) => {
          const workos = config.getClient();
          const seen = new Set<string>();
          let after: string | undefined;
          do {
            const result = await workos.userManagement.listUserApiKeys(userId, {
              organizationId: orgId,
              limit: 100,
              after,
            });
            const key = result.data.find((key) => key.id === apiKeyId);
            if (key) {
              if (key.owner.id !== userId || key.owner.organizationId !== orgId)
                throw new ConvexError({ code: 'not_found', status: 404 });
              await workos.apiKeys.deleteApiKey(key.id);
              return null;
            }
            after = result.listMetadata.after ?? undefined;
            if (after && seen.has(after))
              throw new ConvexError({ code: 'invalid_provider_cursor', status: 502 });
            if (after) seen.add(after);
          } while (after);
          throw new ConvexError({ code: 'not_found', status: 404 });
        },
      }),
    },
    teams: {
      listTeams: internalAction({
        platforms,
        args: { ...identityFields, ...pagination.fields },
        returns: accountPage,
        handler: async (_ctx, { userId, paginationOpts }) => {
          const workos = config.getClient();
          const result = await paginateWorkOS(paginationOpts, (opts) =>
            workos.userManagement.listOrganizationMemberships({ userId, statuses: ['active'], ...opts }),
          );
          return {
            ...result,
            page: await Promise.all(result.page.map((membership) => accountResult(workos, membership))),
          };
        },
      }),
      createTeam: internalAction({
        platforms,
        args: { ...identityFields, name: v.string(), requestId: v.string() },
        returns: account,
        handler: async (ctx, { orgId, userId, name, requestId }) => {
          await requireSession(ctx, { orgId, userId });
          name = validName(name);
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))
            throw new ConvexError({ code: 'invalid_request_id', status: 400 });
          const workos = config.getClient();
          const org = await workos.organizations.createOrganization(
            { name },
            { idempotencyKey: `team:${userId}:${requestId}` },
          );
          const { data } = await workos.userManagement.listOrganizationMemberships({
            userId,
            organizationId: org.id,
            statuses: ['active', 'inactive', 'pending'],
            limit: 1,
          });
          let membership = data[0];
          if (!membership) {
            try {
              membership = await workos.userManagement.createOrganizationMembership({
                userId,
                organizationId: org.id,
                roleSlug: adminRoles[0]!,
              });
            } catch (error) {
              if (!(error instanceof ConflictException)) throw error;
              const replay = await workos.userManagement.listOrganizationMemberships({
                userId,
                organizationId: org.id,
                statuses: ['active', 'inactive', 'pending'],
                limit: 1,
              });
              if (!replay.data[0]) throw error;
              membership = replay.data[0];
            }
          }
          if (membership.userId !== userId) throw new ConvexError({ code: 'forbidden', status: 403 });
          assertAdmin(membershipRole(membership));
          return accountResult(workos, membership, org);
        },
      }),
    },
  };
  const project = <G extends Record<string, { internal: unknown; public: unknown }>>(group: G) => ({
    internal: Object.fromEntries(
      Object.entries(group).map(([name, operation]) => [name, operation.internal]),
    ) as { [K in keyof G]: G[K]['internal'] },
    public: Object.fromEntries(
      Object.entries(group).map(([name, operation]) => [name, operation.public]),
    ) as { [K in keyof G]: G[K]['public'] },
  });
  const accountOperations = project(operations.account);
  const memberOperations = project(operations.members);
  const invitationOperations = project(operations.invitations);
  const apiKeyOperations = project(operations.apiKeys);
  const teamOperations = project(operations.teams);
  return {
    validators: schemas,
    account: accountOperations.internal,
    members: memberOperations.internal,
    invitations: invitationOperations.internal,
    apiKeys: apiKeyOperations.internal,
    teams: teamOperations.internal,
    public: {
      account: accountOperations.public,
      members: memberOperations.public,
      invitations: invitationOperations.public,
      apiKeys: apiKeyOperations.public,
      teams: teamOperations.public,
    },
  };
}
export { createWorkOSWebhook, type WorkOSWebhookConfig } from './workos-webhook.js';
