import { describe, expect, test } from 'bun:test';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import schema from './fixtures/convex/schema.js';
const modules = {
  './_generated/api.ts': async () => ({}),
  './schema.ts': () => import('./fixtures/convex/schema.js'),
  './platforms.ts': () => import('./fixtures/convex/platforms.js'),
  './todos/internal.ts': () => import('./fixtures/convex/todos/internal.js'),
};
const create = makeFunctionReference<'mutation'>('todos/internal:createTodo');
const list = makeFunctionReference<'query'>('todos/internal:listTodos');
const remove = makeFunctionReference<'mutation'>('todos/internal:deleteTodo');
describe('application authorization example', () => {
  test('isolates organizations and restricts deletion by creator or admin', async () => {
    const t = convexTest(schema, modules);
    const identity = { orgId: 'org_one', userId: 'user_owner', role: 'member' };
    const id = await t.mutation(create, { ...identity, text: 'first' });
    const first = await t.query(list, { ...identity, paginationOpts: { numItems: 10, cursor: null } });
    expect(first.page).toHaveLength(1);
    const second = await t.query(list, {
      orgId: 'org_two',
      userId: 'user_other',
      role: 'admin',
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(second.page).toHaveLength(0);
    await expect(
      t.mutation(remove, { orgId: 'org_two', userId: 'user_owner', role: 'admin', id }),
    ).rejects.toThrow();
    await expect(t.mutation(remove, { ...identity, userId: 'user_other', id })).rejects.toThrow();
    await t.mutation(remove, { ...identity, userId: 'user_other', role: 'admin', id });
    expect(
      (await t.query(list, { ...identity, paginationOpts: { numItems: 10, cursor: null } })).page,
    ).toHaveLength(0);
  });
});
