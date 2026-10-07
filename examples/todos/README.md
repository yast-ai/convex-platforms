# Organization-scoped todos

This example includes native internal functions, schema, runtime mounting and JWT provider wiring for API, MCP, CLI and both SDKs. Application functions enforce ownership and organization isolation.

```sh
cd examples/todos
bun install
bun run ports:generate
```

Before the first registry release, replace the package dependency with the reviewed local tarball and run `bun install` instead. Do not run the initializer: this example already contains its complete wiring.

Connect this directory to a development Convex project using `bunx convex dev --configure`. For a Convex-managed WorkOS environment, follow the [onboarding guide](../../docs/onboarding.md) to provision AuthKit first. Set `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, and `WORKOS_AUTHKIT_URL` on that deployment, then run `bun run dev` to generate and deploy. Keep local `.env.local` and generated outputs out of source control. The example does not create users, organizations or memberships.

Enable WorkOS Connect CIMD and register the exact deployment `/mcp` resource. For API keys, create the `api:access` permission, enable it for user API keys and grant it to the actual organization membership role. Issue a user-owned, organization-scoped key.

```sh
bunx convex-platforms --site-url https://YOUR-DEPLOYMENT.convex.site doctor
bunx convex-platforms --site-url https://YOUR-DEPLOYMENT.convex.site login
bunx convex-platforms --site-url https://YOUR-DEPLOYMENT.convex.site todos create --text 'Hello'
bunx convex-platforms --site-url https://YOUR-DEPLOYMENT.convex.site todos list --pagination-opts '{"numItems":10,"cursor":null}'
```

For automated verification, supply `CONVEX_PLATFORMS_TOKEN` through a secret manager. Confirm one authorized user can create, list and delete a test record, while a second organization cannot read or delete it. Client-supplied identity fields must fail. [Full verification sequence](../../docs/testing.md).

`deleteTodo` permits only the creator or an organization admin. These are example application rules, not role defaults imposed by the library. Use only test records in a development deployment.
