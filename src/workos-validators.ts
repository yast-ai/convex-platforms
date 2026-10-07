import type {
  Invitation,
  Organization,
  OrganizationMembership,
  UserApiKey,
  UserApiKeyWithValue,
} from '@workos-inc/node';
import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { v, type Validator } from 'convex/values';

/** Match the role union used by your application's authenticated public wrappers. */
export function createWorkOSValidators<Role extends string>(role: Validator<Role, 'required', string>) {
  const identityFields = { orgId: v.string(), userId: v.string(), role };
  const account = v.object({
    id: v.string(),
    name: v.string(),
    personal: v.boolean(),
    role,
  }) satisfies Validator<Pick<Organization, 'id' | 'name'>, 'required', string>;
  const member = v.object({ id: v.string(), userId: v.string(), role }) satisfies Validator<
    Pick<OrganizationMembership, 'id' | 'userId'>,
    'required',
    string
  >;
  const invitation = v.object({
    id: v.string(),
    email: v.string(),
    state: v.union(v.literal('pending'), v.literal('accepted'), v.literal('expired'), v.literal('revoked')),
    expiresAt: v.string(),
  }) satisfies Validator<Pick<Invitation, 'id' | 'email' | 'state' | 'expiresAt'>, 'required', string>;
  const apiKey = v.object({
    id: v.string(),
    name: v.string(),
    obfuscatedValue: v.string(),
    lastUsedAt: v.union(v.string(), v.null()),
    createdAt: v.string(),
  }) satisfies Validator<
    Pick<UserApiKey, 'id' | 'name' | 'obfuscatedValue' | 'lastUsedAt' | 'createdAt'>,
    'required',
    string
  >;
  const apiKeyCreated = v.object({ ...apiKey.fields, value: v.string() }) satisfies Validator<
    Pick<UserApiKeyWithValue, 'id' | 'name' | 'obfuscatedValue' | 'lastUsedAt' | 'createdAt' | 'value'>,
    'required',
    string
  >;
  return {
    role,
    identityFields,
    account,
    member,
    invitation,
    apiKey,
    apiKeyCreated,
    pagination: v.object({ paginationOpts: paginationOptsValidator }),
    accountPage: paginationResultValidator(account),
    memberPage: paginationResultValidator(member),
    invitationPage: paginationResultValidator(invitation),
    apiKeyPage: paginationResultValidator(apiKey),
  };
}
