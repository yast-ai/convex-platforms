import type { GenericDataModel, HttpRouter } from 'convex/server';
import { ConvexError } from 'convex/values';
import { WorkOS } from '@workos-inc/node';
import type { Manifest } from './contract.js';
import { createPlatformFunctions } from './functions.js';
import { createPlatformServer, type PlatformServerConfig } from './server.js';
import { createWorkOSFunctions, type WorkOSFunctionsConfig } from './workos.js';
import { createWorkOSWebhook, type WorkOSWebhookConfig } from './workos-webhook.js';

export type PlatformsConfig<Role extends string> = Omit<
  WorkOSFunctionsConfig<Role>,
  'resolveIdentity' | 'getClient'
> & {
  /** Optional shared client; defaults to a lazy SDK client from getServerConfig. */
  getClient?: WorkOSFunctionsConfig<Role>['getClient'];
  /** Required only for exported public aliases. Omission denies every public call. */
  resolveIdentity?: WorkOSFunctionsConfig<Role>['resolveIdentity'];
  /** Read deployment settings only when registering HTTP routes, never during discovery. */
  getServerConfig: () => PlatformServerConfig['workos'];
  corsOrigins?: string[];
  webhook?: Omit<WorkOSWebhookConfig, 'getClient'> & { path?: string };
};

/** One integration for native builders, optional WorkOS exports and authenticated HTTP routes. */
export function createPlatforms<
  DataModel extends GenericDataModel = GenericDataModel,
  Role extends string = string,
>(config: PlatformsConfig<Role>) {
  const webhookPrefix = config.webhook?.personal?.externalIdPrefix;
  if (config.personalExternalIdPrefix && webhookPrefix && config.personalExternalIdPrefix !== webhookPrefix)
    throw new Error(
      'Personal organization prefixes must match for WorkOS operations and webhook provisioning.',
    );
  const personalPrefix = config.personalExternalIdPrefix ?? webhookPrefix;
  let settings: PlatformServerConfig['workos'] | undefined;
  let client: WorkOS | undefined;
  const getSettings = () => (settings ??= config.getServerConfig());
  const getClient =
    config.getClient ??
    (() => {
      const server = getSettings();
      return (client ??= new WorkOS(server.apiKey, { clientId: server.clientId }));
    });
  const builders = createPlatformFunctions<DataModel>();
  const workos = createWorkOSFunctions({
    ...config,
    ...(personalPrefix ? { personalExternalIdPrefix: personalPrefix } : {}),
    getClient,
    resolveIdentity:
      config.resolveIdentity ??
      (async () => {
        throw new ConvexError({ code: 'unauthenticated', status: 401 });
      }),
  });
  return {
    ...builders,
    ...workos,
    registerRoutes: (http: HttpRouter, manifest: Manifest): void => {
      const webhook = config.webhook
        ? createWorkOSWebhook({
            ...config.webhook,
            getClient,
            ...(config.webhook.personal
              ? {
                  personal: {
                    ...config.webhook.personal,
                    ...(personalPrefix ? { externalIdPrefix: personalPrefix } : {}),
                  },
                }
              : {}),
          })
        : undefined;
      const server = createPlatformServer({
        manifest,
        workos: getSettings(),
        workosClient: getClient(),
        rolePriority: [...config.roles],
        ...(config.corsOrigins ? { corsOrigins: config.corsOrigins } : {}),
      });
      server.registerRoutes(http);
      if (webhook)
        http.route({ path: config.webhook?.path ?? '/api/workos/webhook', method: 'POST', handler: webhook });
    },
  };
}
