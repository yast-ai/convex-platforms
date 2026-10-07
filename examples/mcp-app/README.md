# MCP Apps React example

`TodoList.tsx` is host-neutral presentation code. `todos.tsx` is the MCP wrapper: it creates the package bridge, uses the host theme, receives `structuredContent.result`, and calls `todos_list` through the host with Convex pagination.

The wrapper has no bearer token, WorkOS credential, Convex client, or Convex hook. The MCP host authenticates the tool call and forwards it to the generated `todos_list` tool.

To link this UI to an internal function, set `ui: 'todos'` on an MCP-enabled `listTodos` function and place these files in the consuming app's `platforms/ui/` directory. Run `convex-platforms generate`; it bundles `todos.html` into a content-hashed `ui://` resource and attaches that URI to the generated `todos_list` metadata.

```ts
export const listTodos = internalQuery({
  platforms: { mcp: true },
  ui: 'todos',
  // args include orgId, userId, role, paginationOpts
});
```

The runtime sends tool output as `{ result: { page, isDone, continueCursor } }`. Refresh calls the same `todos_list` tool with `{ paginationOpts: { numItems: 20, cursor: null } }` through the MCP Apps bridge.

The shared package keeps React, React DOM, Vite, and its build plugins optional peers. This example selects those peers in its own package file. Use `bun run typecheck` to check the example and `bun run bundle` to build its standalone MCP resource after installing its dependencies. `bun run preview:mock` serves `mock.html`, a clearly labeled browser-only harness for the presentational component. It does not test host authentication, tool calls, or iframe behavior.
