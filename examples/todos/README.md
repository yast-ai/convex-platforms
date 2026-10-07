# Organization-scoped todos

This example demonstrates native internal functions exposed through API, MCP, CLI and SDKs. It owns its schema and authorization. No WorkOS account, organization or production deployment is provisioned automatically.

Install the example dependencies with Bun. Before the first registry release, install the reviewed local tarball in this folder instead of the versioned registry dependency. Run `bunx convex-platforms init --name todos-example`: the example already supplies its typed `convex/platforms.ts`, so retain that file and add the runtime mount/auth wiring from the root onboarding guide manually. Generate before pushing to a development deployment.

Use `listTodos` for organization-scoped paginated reads. `deleteTodo` permits only the creator or an organization admin. These are example application rules, not role defaults imposed by the library.

Complete WorkOS environment and Connect configuration, test web/session or API-key auth, then run the CLI and MCP tool. Do not point this example at customer production data.
