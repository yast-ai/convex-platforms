# Reusable WorkOS accounts and teams

The optional `@disposabl/convex-platforms/workos` export supplies account, team, member, invitation and user API-key operations. Their business logic, authorization policies, validators, pagination and native public wrappers live in the package. Your app provides authentication and lazy WorkOS configuration, then exports only the operations it wants from one `convex/workos.ts` file.

Functions run in the consuming application's Convex deployment. They do not create component tables or use a separate database. WorkOS remains the source of organizations, memberships, invitations and user API keys.

## Configure once

```ts
// convex/workos.ts
import { WorkOS } from '@workos-inc/node';
import { v } from 'convex/values';
import { createWorkOSFunctions } from '@disposabl/convex-platforms/workos';
import { requireUser } from './auth';
import { env } from './_generated/server';

let client: WorkOS | undefined;
const workos = createWorkOSFunctions({
  role: v.union(v.literal('admin'), v.literal('member')),
  roles: ['admin', 'member'],
  adminRoles: ['admin'],
  defaultRole: 'member',
  getClient: () =>
    (client ??= new WorkOS(env.WORKOS_API_KEY, {
      clientId: env.WORKOS_CLIENT_ID,
    })),
  getSessionIssuers: () => [
    'https://api.workos.com/',
    `https://api.workos.com/user_management/${env.WORKOS_CLIENT_ID}`,
  ],
  resolveIdentity: requireUser,
  personalExternalIdPrefix: 'personal:',
  platforms: true,
});

// Export exactly the builtins your app wants. No account or team folders are needed.
export const { getAccount, listMembers, listTeams, createTeam } = workos.functions;

// Optional authenticated web/mobile endpoints; aliases avoid duplicate export names.
export const { getAccount: getAccountPublic, listMembers: listMembersPublic } = workos.publicFunctions;
```

`requireUser` is your application's authentication callback. It must resolve trusted `{ orgId, userId, role }` from `ctx.auth`, reject unauthenticated callers and allow only your intended web/device issuers. It receives an auth context, never client identity arguments. Use the same literal role union in your authentication callback and package configuration. `roles` is ordered from highest priority to lowest; memberships with several supported roles use the first match. `adminRoles` permits account, membership and invitation administration. `defaultRole` is used when an invitation omits its role. The first `adminRoles` entry owns newly created teams.

Declare credential environment variables in your app's Convex configuration or use its managed WorkOS integration so the generated `env` has their types. Store and validate required credentials on each deployment before deploying. Lazy configuration callbacks let local generation discover functions without reading credentials, authenticating or calling WorkOS. Configure `platforms` with the same selection flags as other internal functions. It defaults to all interfaces. Public web functions are independent of those flags.

## Select or replace functions

Convex discovers exported native functions from `convex/workos.ts`. Unexported package functions are absent from Convex's callable API and from generated interfaces. Internal exports use `internal.workos.getAccount`; optional public aliases use `api.workos.getAccountPublic`. Public wrappers authenticate first, omit identity arguments and share the package operation logic. They have no platform metadata, so generation never includes a public duplicate.

`workos.functions` is a flat object containing all 14 native internal operations. `workos.publicFunctions` contains their native authenticated public wrappers with the same keys. The existing grouped `workos.account`, `workos.members`, `workos.invitations`, `workos.apiKeys`, `workos.teams` and `workos.public` exports remain supported.

| Logical resource      | Operations                                                                  |
| --------------------- | --------------------------------------------------------------------------- |
| `account`             | `getAccount`, `updateAccount`                                               |
| `account/members`     | `listMembers`, `updateMemberRole`, `removeMember`                           |
| `account/invitations` | `listInvitations`, `sendInvitation`, `resendInvitation`, `revokeInvitation` |
| `account/apiKeys`     | `listApiKeys`, `createApiKey`, `revokeApiKey`                               |
| `teams`               | `listTeams`, `createTeam`                                                   |

Each builtin carries its logical `resource` metadata. Exporting `listMembers` from `convex/workos.ts` produces `/api/v1/account/members/list`, `account_members_list`, `account members list` and `client.account.members.list`; its actual Convex reference stays `workos:listMembers`. Keep the operation names when destructuring internal functions.

To replace a builtin, omit it from the package destructuring and export your own native internal function with the same operation name and logical resource. Your own function owns its authorization and business logic:

```ts
// Additional imports in the same convex/workos.ts file:
import { createPlatformFunctions, identityFields } from '@disposabl/convex-platforms/functions';
import type { DataModel } from './_generated/dataModel';

// Do not include getAccount in the builtin destructuring above.
const { internalQuery } = createPlatformFunctions<DataModel>();
export const getAccount = internalQuery({
  resource: ['account'],
  platforms: { api: true, mcp: true },
  args: identityFields,
  returns: v.object(identityFields),
  handler: (_ctx, { orgId, userId, role }) => ({ orgId, userId, role }),
});
```

A custom operation may instead use its own name and resource. Without `resource`, generation derives the namespace from its feature folder as before. Explicit resources must be nonempty arrays of safe lowerCamelCase segments; traversal, reserved names and duplicate interface names are rejected. The metadata changes interface naming, never the Convex function that executes. If you replace an internal builtin, provide your own web wrapper too, or omit its package public alias: package public wrappers continue to call package logic.

Choose interfaces globally with `platforms`, or override individual builtins in the same factory configuration:

```ts
operationPlatforms: {
  listMembers: { mcp: true },
  createTeam: false,
  listApiKeys: { api: true, cli: true },
},
```

An omitted override inherits the global selection. `false` disables generated interfaces while retaining a native function if you export it. Export selection controls registration; interface selection controls generated exposure. Public web wrappers remain independent. `workos.validators` exposes shared boundary schemas, or use `createWorkOSValidators(role)` independently.

`getAccount` remains a native query returning the trusted identity. Operations requiring WorkOS are native actions. Team creation requires a UUID `requestId`; retry the same request with the same ID to reuse its organization. A scoped conflict lookup recovers concurrent owner-membership creation without deleting organizations or changing existing memberships.

## Authorization and pagination

Administrative operations reject non-administrators. Personal organizations cannot be renamed or have their membership/invitations administered. Members cannot modify or remove their own administrative membership, and directory-managed memberships remain provider-managed. Membership and invitation IDs are checked against the selected organization before any change. API keys belong to the authenticated user and selected organization; creation grants exactly `api:access`, and the secret is returned only on creation.

`createApiKey` and `createTeam` require an actual first-party WorkOS web/device identity whose issuer is both configured and an exact `api.workos.com` session issuer. Its subject and organization claim must match the trusted identity. API keys and WorkOS Connect tokens cannot call these operations, even when the transport supports the other account operations.

The transport or public authentication callback establishes the caller's identity and role. Internal operations enforce resource access using those trusted fields. They do not accept client-supplied identity, forge `ctx.auth`, or repeat membership resolution. API/MCP transports resolve current active membership; a web callback controls its own session refresh and role policy.

Collection operations accept native Convex `paginationOpts` and return `{ page, isDone, continueCursor }`. WorkOS page sizes are integers from 1 through 100. End cursors and database read/byte limits are not supported for provider-backed pagination. User API-key revocation walks scoped pages and rejects repeated provider cursors.

## Optional personal organization webhook

If your app synchronizes WorkOS users, the package can provision personal organizations before committing each user event:

```ts
import { createWorkOSWebhook } from '@disposabl/convex-platforms/workos';

http.route({
  path: '/api/workos/webhook',
  method: 'POST',
  handler: createWorkOSWebhook({
    getClient: () => getAuthKit().workos,
    getWebhookSecret: () => env.WORKOS_WEBHOOK_SECRET,
    personal: { name: 'Personal', externalIdPrefix: 'personal:', ownerRole: 'admin' },
    isUserSynced: async (ctx, userId) =>
      !!(await ctx.runQuery(components.workOSAuthKit.lib.getAuthUser, { id: userId })),
    syncEvent: async (ctx, event) => {
      await ctx.runMutation(components.workOSAuthKit.lib.onWebhookEvent, {
        event: { id: event.id, event: event.event, data: event.data, createdAt: event.createdAt },
      });
    },
  }),
});
```

The SDK verifies the signature against the raw body before any provisioning or synchronization callback. User creation/update events provision only when `isUserSynced` returns false. A stale event for a deleted WorkOS user is acknowledged without synchronizing that deleted user. Provisioning errors remain unacknowledged so WorkOS can retry; synchronization runs after provisioning succeeds.

With personal provisioning enabled, the handler ensures the environment's `api:access` permission exists and attaches it to `ownerRole` when missing. This changes that environment role for all organizations using it. Choose the owner role deliberately. Organization creation uses a stable external ID and idempotency key; conflict recovery re-reads the exact organization, permission or membership. Existing inactive/pending memberships are retained without reactivation or role changes. Omit `personal` to verify and synchronize events without provisioning.

The package does not depend on an AuthKit Convex component. The example callbacks use one, but you can supply another synchronization implementation. Configure the provider's webhook URL and signing secret for the deployment where you register this route.

## Verification

Offline tests execute native functions and HTTP handlers with `convex-test`, mock provider calls to verify authorization and replay behavior, and verify a real signed webhook using the WorkOS SDK. Packed-consumer checks compile literal role types and discover a selected one-file subset with a custom replacement, while excluding omitted builtins and public duplicates. These tests do not prove your own WorkOS environment's role configuration or live host OAuth authorization. Verify those with an owned development user before production deployment.
