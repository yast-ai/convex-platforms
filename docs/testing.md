# Testing and verification

## Offline

The library test suite checks native internal builders, schema conversion, exposure flags, deterministic generation, route dispatch, WorkOS authentication failures, identity forgery, current membership, CLI discovery, private rotating sessions, plugin packaging and generated client behavior.

Run `bun install --frozen-lockfile`, then `bun run check`. Install a packed tarball in a fresh consumer and compile its declarations. Execute generated TypeScript and Python clients against a local contract fixture. These tests require no production credentials.

Use Convex's `convex-test` in consuming apps to test tenant isolation and ownership inside business functions. Mock users deliberately: authorized user, different organization, insufficient role, deleted membership and expired/invalid credentials. Do not mirror the implementation with tests that always return success.

## Deployed development environment

1. Generate selected outputs and push the example to an explicitly identified development deployment.
2. Run `convex-platforms --site-url https://YOUR-DEPLOYMENT.convex.site doctor`.
3. Authenticate a real API caller and create/list/delete a test record. Supply fake `orgId`, `userId` and `role`; each must fail.
4. Verify a valid user from a second organization cannot read or modify the first organization's record.
5. Complete real CLI device authorization; execute a command, refresh, relaunch and logout.
6. Install and authorize the MCP plugin in each supported target host. Run a tool and visibly verify any linked UI.
7. Revoke membership or the test API key and confirm access stops.

`doctor` verifies public wiring only. Do not describe offline mocks, compilation, dry-run packing or an unauthenticated challenge as live OAuth proof.

## Production

Generate the same reviewed contract, use a production WorkOS environment and its exact resource audience, run all checks and publish the npm version from trusted GitHub Actions. Fresh-install that exact version from the registry and rerun the example. Keep test records separate from customer data.

Record the source commit, package version/integrity, deployment, commands, observed results, host versions and remaining limitations in release evidence.

The network transport regression runs in CI with Python 3.12. To run it locally, use Python 3.11+ and `PLATFORMS_NETWORK_TESTS=1 PYTHON=python3 bun test`. A filesystem/network sandbox may require approved local network access; the test is visibly skipped in ordinary sandboxed runs.
