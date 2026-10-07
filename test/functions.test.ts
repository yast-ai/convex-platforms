import { describe, expect, test } from 'bun:test';
import { v } from 'convex/values';
import type { GenericDataModel } from 'convex/server';
import { createPlatformFunctions, identityFields, validatorMetadata } from '../src/functions.js';
const builders = createPlatformFunctions<GenericDataModel>();
describe('native builders', () => {
  test('remain native internal functions with exact validators and metadata', () => {
    const def = {
      platforms: { mcp: true } as const,
      args: { ...identityFields, text: v.string() },
      returns: v.string(),
      handler: async (_ctx: unknown, args: { text: string }) => args.text,
    };
    const mutation = builders.internalMutation(def);
    expect(mutation.isInternal).toBe(true);
    expect(mutation.isMutation).toBe(true);
    expect(JSON.parse(mutation.exportArgs())).toEqual(v.object(def.args).json);
    expect(Object.getOwnPropertyDescriptor(mutation, validatorMetadata)?.enumerable).toBe(false);
    expect((mutation as unknown as { platforms: unknown }).platforms).toEqual({ mcp: true });
  });
  test('query and action visibility remain internal', () => {
    const def = { args: identityFields, returns: v.null(), handler: () => null };
    expect(builders.internalQuery(def).isInternal).toBe(true);
    expect(builders.internalAction(def).isInternal).toBe(true);
  });
});
