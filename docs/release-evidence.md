# Initial release verification

Verified on 2026-10-07 using Bun 1.4.2, Node 24 and Python 3.12. This record distinguishes executed checks from remaining interactive verification.

## Executed

- Formatting, linting, TypeScript checking and build passed.
- 43 tests passed, including native Convex query/mutation/action discovery, selection flags, pagination contracts, identity stripping, tenant isolation, official Streamable HTTP MCP client interoperability, session rotation and real TypeScript/Python loopback transports.
- A packed installation imports the public exports, compiles typed native builders, executes the installed Node and Bun binaries, generates from real Convex builders, and compiles generated SDKs.
- A fresh Convex development project `yast-ai/convex-platforms-demo`, deployment `hip-lark-939`, provisioned a managed WorkOS environment. CIMD was enabled and its exact `/mcp` resource registered. The package installed from the reviewed tarball and deployed successfully.
- Real WorkOS user API keys resolved the active `demo-builder` organization membership role. API create/list/delete returned 200. A second organization saw no records and could not delete the first organization's record (404). Client identity forgery returned 400. The application's structured `invalid_text` error preserved its safe 400 status.
- The installed CLI discovered the deployed commands and completed create/list/delete. Both generated TypeScript and Python SDKs completed the same sequence against the deployed API.
- The 90-second onboarding video rendered and its decoded frames were inspected. Its provider setup scenes are labeled diagrams.

Real membership deactivation stopped API access immediately (401); reactivation restored access (200).

A real deployment test caught callable native Convex definitions being skipped by discovery. The repair includes native builder fixtures and packed-consumer regression coverage; synthetic metadata fixtures no longer provide the generator's integration proof.

## Interactive checks still required

Real CLI device confirmation/refresh, WorkOS Connect OAuth authorization, installation in ChatGPT and Claude, and a visible MCP Apps UI interaction have not been verified in those hosts. Protocol tests and public discovery checks do not substitute for that evidence.

Actual provider dashboard footage has not been recorded. No diagram is presented as a dashboard recording.

## Registry publication

The initial `@disposabl/convex-platforms@0.1.0` publication succeeded from the authenticated maintainer CLI. Its public version endpoint and tarball both returned HTTP 200. npm recorded the package as public.

npm confirmed the trusted publisher for repository `yast-ai/convex-platforms`, workflow `publish.yml`, with direct publish permission. Version `0.1.1` published automatically after the version change on `main`, from source commit `68ea3c0ce7df104607907f354bff8d6e3862da65`. The [publish workflow](https://github.com/yast-ai/convex-platforms/actions/runs/37598838964) executed its publish step successfully and signed GitHub Actions provenance. The matching [CI run](https://github.com/yast-ai/convex-platforms/actions/runs/37598838926) passed.

npm returned version `0.1.1`, executable `dist/cli.js`, and SLSA provenance metadata. Published integrity:

```text
sha512-og1FsdyAxIdxiQlRnjolqlfHi1D4MgryQU5hsCh4HROFjZv9jZE8bRFr4WXgOOisrxY6PmaeXMXelYDUMrUC3Q==
```

A completely fresh consumer installed the exact version from the public registry, ran `init`, generated all three native todo operations, passed the generation check and executed the installed CLI help. The development demo also replaced its local tarball dependency with registry version `0.1.1`.

No long-lived npm publishing token was stored in GitHub. The initializer does not configure a consuming application's deployment CI; each app must generate before its own deployment.
