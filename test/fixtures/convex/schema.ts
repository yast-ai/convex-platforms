import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
export default defineSchema({
  todos: defineTable({ orgId: v.string(), userId: v.string(), text: v.string() }).index('by_orgId', [
    'orgId',
  ]),
});
