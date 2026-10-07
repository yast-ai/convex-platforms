import { createPlatformFunctions, identityFields } from '../../../src/functions.js';
import type { DataModelFromSchemaDefinition } from 'convex/server';
import schema from './schema';
export const { internalQuery, internalMutation, internalAction } =
  createPlatformFunctions<DataModelFromSchemaDefinition<typeof schema>>();
export { identityFields };
