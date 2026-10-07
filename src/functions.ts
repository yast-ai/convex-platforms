import {
  internalQueryGeneric,
  internalMutationGeneric,
  internalActionGeneric,
  type GenericDataModel,
  type GenericQueryCtx,
  type GenericMutationCtx,
  type GenericActionCtx,
  type QueryBuilder,
  type MutationBuilder,
  type ActionBuilder,
  type RegisteredQuery,
  type RegisteredMutation,
  type RegisteredAction,
} from 'convex/server';
import {
  v,
  type GenericValidator,
  type Infer,
  type PropertyValidators,
  type ObjectType,
} from 'convex/values';
import type { Platforms } from './contract.js';

export const identityFields = { orgId: v.string(), userId: v.string(), role: v.string() };
export const validatorMetadata = Symbol.for('yast.convex-platforms.validators');
type Definition<Ctx, Args extends PropertyValidators, Returns extends GenericValidator> = {
  platforms?: Platforms;
  /** Logical resource path, independent of the consuming Convex module. */
  resource?: readonly string[];
  ui?: string;
  description?: string;
  args: Args;
  returns: Returns;
  handler: (ctx: Ctx, args: ObjectType<Args>) => Infer<Returns> | Promise<Infer<Returns>>;
};
function annotate<R extends object, Ctx, A extends PropertyValidators, V extends GenericValidator>(
  registered: R,
  definition: Definition<Ctx, A, V>,
): R {
  Object.defineProperty(registered, validatorMetadata, {
    value: { args: definition.args, returns: definition.returns },
  });
  return Object.assign(registered, {
    platforms: definition.platforms,
    resource: Array.isArray(definition.resource) ? [...definition.resource] : definition.resource,
    ui: definition.ui,
    description: definition.description,
  });
}
/** Bind once to the consuming app's generated DataModel. Functions remain native internal functions. */
export function createPlatformFunctions<DataModel extends GenericDataModel>() {
  const query = internalQueryGeneric as QueryBuilder<DataModel, 'internal'>;
  const mutation = internalMutationGeneric as MutationBuilder<DataModel, 'internal'>;
  const action = internalActionGeneric as ActionBuilder<DataModel, 'internal'>;
  return {
    internalQuery: <A extends PropertyValidators, R extends GenericValidator>(
      definition: Definition<GenericQueryCtx<DataModel>, A, R>,
    ): RegisteredQuery<'internal', ObjectType<A>, Infer<R>> => annotate(query(definition), definition),
    internalMutation: <A extends PropertyValidators, R extends GenericValidator>(
      definition: Definition<GenericMutationCtx<DataModel>, A, R>,
    ): RegisteredMutation<'internal', ObjectType<A>, Infer<R>> => annotate(mutation(definition), definition),
    internalAction: <A extends PropertyValidators, R extends GenericValidator>(
      definition: Definition<GenericActionCtx<DataModel>, A, R>,
    ): RegisteredAction<'internal', ObjectType<A>, Infer<R>> => annotate(action(definition), definition),
  };
}
