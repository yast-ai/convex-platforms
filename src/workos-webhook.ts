import { ConflictException, NotFoundException, type Event, type WorkOS } from '@workos-inc/node';
import { httpActionGeneric, type GenericActionCtx, type GenericDataModel } from 'convex/server';

export type WorkOSWebhookConfig = {
  getClient: () => WorkOS;
  getWebhookSecret: () => string;
  isUserSynced: (ctx: GenericActionCtx<GenericDataModel>, userId: string) => Promise<boolean>;
  syncEvent: (ctx: GenericActionCtx<GenericDataModel>, event: Event) => Promise<void>;
  /** Omit to sync events without creating personal organizations. */
  personal?: { name?: string; externalIdPrefix?: string; ownerRole: string };
};

/** Verify WorkOS signatures, provision personal organizations, then synchronize the event. */
export function createWorkOSWebhook(config: WorkOSWebhookConfig) {
  const personal = config.personal
    ? {
        name: config.personal.name ?? 'Personal',
        externalIdPrefix: config.personal.externalIdPrefix ?? 'personal:',
        ownerRole: config.personal.ownerRole,
      }
    : undefined;
  if (
    personal &&
    (!personal.name.trim() || personal.name.length > 100 || !personal.externalIdPrefix || !personal.ownerRole)
  )
    throw new Error('Personal organization name, external ID prefix and owner role are required.');
  return httpActionGeneric(async (ctx, request) => {
    const workos = config.getClient();
    const event = await workos.webhooks.constructEvent({
      payload: await request.text(),
      sigHeader: request.headers.get('workos-signature') ?? '',
      secret: config.getWebhookSecret(),
    });
    if (personal && (event.event === 'user.created' || event.event === 'user.updated')) {
      const userId = event.data.id;
      if (!(await config.isUserSynced(ctx, userId))) {
        try {
          await workos.userManagement.getUser(userId);
        } catch (error) {
          if (error instanceof NotFoundException) return new Response('OK');
          throw error;
        }
        const externalId = `${personal.externalIdPrefix}${userId}`;
        const org = await workos.organizations
          .getOrganizationByExternalId(externalId)
          .catch(async (error: unknown) => {
            if (!(error instanceof NotFoundException)) throw error;
            try {
              return await workos.organizations.createOrganization(
                { name: personal.name, externalId },
                { idempotencyKey: `personal:${externalId}` },
              );
            } catch (error) {
              if (!(error instanceof ConflictException)) throw error;
              return workos.organizations.getOrganizationByExternalId(externalId);
            }
          });
        await workos.authorization.getPermission('api:access').catch(async (error: unknown) => {
          if (!(error instanceof NotFoundException)) throw error;
          try {
            return await workos.authorization.createPermission({ name: 'API access', slug: 'api:access' });
          } catch (error) {
            if (!(error instanceof ConflictException)) throw error;
            return workos.authorization.getPermission('api:access');
          }
        });
        const role = await workos.authorization.getEnvironmentRole(personal.ownerRole);
        if (!role.permissions.includes('api:access')) {
          try {
            await workos.authorization.addEnvironmentRolePermission(personal.ownerRole, {
              permissionSlug: 'api:access',
            });
          } catch (error) {
            if (!(error instanceof ConflictException)) throw error;
            const replay = await workos.authorization.getEnvironmentRole(personal.ownerRole);
            if (!replay.permissions.includes('api:access')) throw error;
          }
        }
        const options = {
          userId,
          organizationId: org.id,
          statuses: ['active', 'inactive', 'pending'] as const,
          limit: 1,
        };
        const { data } = await workos.userManagement.listOrganizationMemberships({
          ...options,
          statuses: [...options.statuses],
        });
        if (!data.length) {
          try {
            await workos.userManagement.createOrganizationMembership({
              userId,
              organizationId: org.id,
              roleSlug: personal.ownerRole,
            });
          } catch (error) {
            if (!(error instanceof ConflictException)) throw error;
            const replay = await workos.userManagement.listOrganizationMemberships({
              ...options,
              statuses: [...options.statuses],
            });
            if (!replay.data.length) throw error;
          }
        }
      }
    }
    // Do not acknowledge failed provisioning. WorkOS retries the original event.
    await config.syncEvent(ctx, event);
    return new Response('OK');
  });
}
