import { createPlatformFunctions, identityFields } from '@yast-ai/convex-platforms/functions';
import type { DataModelFromSchemaDefinition } from 'convex/server';
import schema from './schema';
export const { internalQuery, internalMutation, internalAction } =
  createPlatformFunctions<DataModelFromSchemaDefinition<typeof schema>>();
export { identityFields };
