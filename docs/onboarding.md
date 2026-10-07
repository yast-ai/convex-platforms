# Onboarding

Choose the path matching your starting point. All three end with the same app-local internal functions, generated interfaces, WorkOS-authenticated routes and tests.

## 1. New to Convex and WorkOS

1. Create a Convex project with `bunx create-convex@latest`. Select your framework and AuthKit as the authentication option.
2. Start the generated app. Follow the Convex onboarding prompts to create a Convex-managed WorkOS team. Account-level association enables automatic environment provisioning and configuration for eligible deployments. Team/project administrator access is required for shared production setup.
3. Confirm the selected Convex deployment is the intended development environment. Finish the template's real sign-in flow before adding interfaces.
4. Install this package, run `convex-platforms init`, and follow `platforms/SETUP.md`.
5. Configure WorkOS Connect for MCP as described below. Managed AuthKit configuration is not evidence that CIMD and MCP resource registration are enabled.
6. Add one organization-scoped example operation, generate, deploy to development, and execute it as an authorized user.

Official starting points: [Convex + AuthKit](https://docs.convex.dev/auth/authkit), [Convex dashboard](https://dashboard.convex.dev/), [WorkOS dashboard](https://dashboard.workos.com/).

## 2. Existing Convex with managed WorkOS

Keep your schema, web authentication and HTTP routes. The initializer refuses to overwrite existing files. Import the typed internal builders from `convex/platforms.ts` for selected functions. Add the two route-mounting lines to existing `http.ts`.

Merge the package's JWT provider configuration into your existing `auth.config.ts`; do not remove working providers. Read the existing `convex.json` AuthKit configuration before changing it. Managed configuration and manual auth files must agree on issuers and audiences.

Use the WorkOS environment linked to that exact Convex deployment, and complete Connect setup there. Generate before `convex dev` or deployment. Verify web authentication still works afterward.

## 3. Existing Convex with an existing WorkOS team

Creating additional WorkOS environments through Convex requires a Convex-managed WorkOS team. Convex can still auto-configure an existing environment when its credentials and the appropriate authKit section in convex.json are present. If you retain an independent WorkOS team, provide each environment's credentials explicitly; do not assume new environments are auto-provisioned. See [automatic AuthKit configuration](https://docs.convex.dev/auth/authkit/auto-provision).

Set `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, and the trusted public HTTPS AuthKit origin `WORKOS_AUTHKIT_URL` on the target Convex deployment. Configure web callback URLs using your framework's WorkOS integration. Do not share production credentials with development or browser bundles.

Keep existing public functions and sessions working, add package routing and internal builder imports, then complete Connect setup for each deployment.

## Required WorkOS Connect settings for MCP

In the matching WorkOS environment:

1. Enable WorkOS Connect and Client ID Metadata Document support, CIMD, for MCP clients.
2. Register the exact public resource URL, for example `https://YOUR-DEPLOYMENT.convex.site/mcp`. Preview and production URLs are distinct resources.
3. Confirm the trusted AuthKit issuer origin. Configure the package's `authkitUrl` using that origin, never a request header or a client-supplied value.
4. Configure Convex's custom JWT provider with that issuer, its JWKS endpoint and the exact MCP resource audience using the package helper.
5. Use an active organization membership. Personal users need a real organization if your application exposes organization-scoped operations. This package does not create Personal organizations or assign roles automatically.

The package serves protected-resource metadata and a `WWW-Authenticate` challenge. Hosts discover the authorization server there. Legacy MCP transport is disabled.

See [WorkOS MCP documentation](https://workos.com/docs/authkit/mcp) and [Client ID Metadata support](https://workos.com/changelog/client-id-metadata-support-for-mcp-auth).

## CLI device login and API keys

Enable WorkOS CLI authentication in your environment and confirm device authorization works with the published WorkOS client ID. Organization selection happens during confirmation. A refreshed session must stay in that organization.

For API keys, create the `api:access` permission and grant it to the actual roles that may use APIs. Issue a user-owned key in the user's selected organization. Organization-owned or machine keys are rejected by this package because operations require a user identity.

App-specific membership provisioning, role permissions, organization creation, webhooks and sign-in UX belong to your app. WorkOS and Convex remain the only backend services required by the platform layer.

## Verification order

```text
Real web sign-in
    → authenticated API read/write
    → rejected identity forgery and cross-organization access
    → CLI device login, operation, refresh and logout
    → MCP OAuth installation and live tool call
    → optional UI interaction in each supported host
```

Provider dashboard footage must show the actual configuration state. The repository's diagrams and offline tests are not evidence of a completed account setup.
