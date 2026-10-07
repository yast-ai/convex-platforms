# Release verification

## Reusable WorkOS accounts and teams in 0.2.0

The optional `./workos` module owns all 14 account, team, member, invitation and user API-key operations, their native public wrappers, boundary validators and provider pagination. It also provides signed webhook handling with optional personal-account provisioning. Consumers configure authentication, roles and WorkOS access, then export the selected native functions.

- Formatting, lint, typechecking, build and frozen dependency installation passed. The full package suite passed 74 tests with 284 assertions.
- An independent security review passed the 30 new operation/webhook tests with 154 assertions and found no remaining blockers.
- A fresh packed consumer imported the public exports, compiled exact role types and public argument types, discovered all 14 internal operations without public duplicates, and compiled generated TypeScript/Python clients and initialized project files.
- Two development consumers compiled and deployed the candidate with Convex typechecking enabled.
- Seventeen live checks passed against an owned disposable WorkOS development user: account identity, team/member/invitation/API-key reads, native pagination, client identity rejection, session-only creation denied for API keys, self-membership protection, foreign API-key rejection, invalid email/page-size rejection, account rename/restore, key revocation and post-revocation denial. The temporary key was revoked and the original organization name restored. No invitations were sent.

Webhook provisioning and conflict recovery were exercised with native `convex-test` HTTP handlers and provider mocks; signature verification also used the real WorkOS SDK and HMAC. These checks do not claim a fresh live signup or native ChatGPT/Claude installation. Real Connect OAuth and host tool/UI verification remain unverified.

## Earlier platform release verification

Verified on 2026-10-07 using Bun 1.4.2, Node 24 and Python 3.12. This record distinguishes executed checks from remaining interactive verification.

## Executed

- Formatting, linting, TypeScript checking and build passed.
- 44 tests passed, including native Convex query/mutation/action discovery, selection flags, pagination contracts, identity stripping, tenant isolation, official Streamable HTTP MCP client interoperability, session rotation, isolated Tailwind and TypeScript alias bundling, and real TypeScript/Python loopback transports.
- A packed installation imports the public exports, compiles typed native builders and all initialized Convex integration files, executes the installed Node and Bun binaries, generates from real Convex builders, and compiles generated SDKs.
- A fresh Convex development project `yast-ai/convex-platforms-demo`, deployment `hip-lark-939`, provisioned a managed WorkOS environment. CIMD was enabled and its exact `/mcp` resource registered. The package installed from the reviewed tarball and deployed successfully.
- Real WorkOS user API keys resolved the active `demo-builder` organization membership role. API create/list/delete returned 200. A second organization saw no records and could not delete the first organization's record (404). Client identity forgery returned 400. The application's structured `invalid_text` error preserved its safe 400 status.
- The installed CLI discovered the deployed commands and completed create/list/delete. Both generated TypeScript and Python SDKs completed the same sequence against the deployed API.
- The installed npm CLI completed real WorkOS device authorization in Chrome with a disposable development user, including WorkOS organization selection. Device-authenticated create/list/delete passed. Refresh credentials rotated without organization drift, the private session stored only the refresh token and organization/client identifiers with directory mode 0700 and file mode 0600, logout removed it, and a subsequent operation was rejected.
- The 90-second onboarding video rendered and its decoded frames were inspected. Its provider setup scenes are labeled diagrams.
- The 74-second setup tour rendered and its decoded frames were inspected. It shows the actual QA WorkOS plus button, the actual QA workspace dialog with only its button appearance edited, and the actual connected Yast integration. Edited button appearance and separate teams are labeled.
- Both existing TinyAPK widget sources bundled successfully into standalone HTML, retaining Tailwind styling and shared-component aliases. This is bundling evidence; actual host authorization and interaction remain separate checks.

Real membership deactivation stopped API access immediately (401); reactivation restored access (200).

A real deployment test caught callable native Convex definitions being skipped by discovery. The repair includes native builder fixtures and packed-consumer regression coverage; synthetic metadata fixtures no longer provide the generator's integration proof.

## Interactive checks still required

WorkOS Connect OAuth authorization, installation in ChatGPT and Claude, and a visible MCP Apps UI interaction have not been verified in those hosts. Protocol tests and public discovery checks do not substitute for that evidence.

Actual provider dashboard stills have been captured and included in a rendered setup tour. It is a screenshot-based tour, not a continuous setup recording. Edited onboarding imagery is labeled separately. No diagram is presented as a dashboard recording.

## Registry publication

The initial `@disposabl/convex-platforms@0.1.0` publication succeeded from the authenticated maintainer CLI. Its public version endpoint and tarball both returned HTTP 200. npm recorded the package as public.

npm confirmed the trusted publisher for repository `yast-ai/convex-platforms`, workflow `publish.yml`, with direct publish permission. Version `0.1.1` published automatically after the version change on `main`, from source commit `68ea3c0ce7df104607907f354bff8d6e3862da65`. The [publish workflow](https://github.com/yast-ai/convex-platforms/actions/runs/37598838964) executed its publish step successfully and signed GitHub Actions provenance. The matching [CI run](https://github.com/yast-ai/convex-platforms/actions/runs/37598838926) passed.

npm returned version `0.1.1`, executable `dist/cli.js`, and SLSA provenance metadata. Published integrity:

```text
sha512-og1FsdyAxIdxiQlRnjolqlfHi1D4MgryQU5hsCh4HROFjZv9jZE8bRFr4WXgOOisrxY6PmaeXMXelYDUMrUC3Q==
```

A completely fresh consumer installed the exact version from the public registry, ran `init`, generated all three native todo operations, passed the generation check and executed the installed CLI help. The development demo also replaced its local tarball dependency with registry version `0.1.1`.

No long-lived npm publishing token was stored in GitHub. The initializer does not configure a consuming application's deployment CI; each app must generate before its own deployment.

### Version 0.1.4

The [matching CI](https://github.com/yast-ai/convex-platforms/actions/runs/37604590777) and [trusted publication](https://github.com/yast-ai/convex-platforms/actions/runs/37604590988) passed at source `d5739e6a028794d9149ceab28772f47fb1cc2b27`. The publish step ran, and npm's public registry subsequently returned version `0.1.4`, its tarball URL and integrity. [Signed provenance](https://search.sigstore.dev/?logIndex=3128795525).

```text
sha512-HaO7xoLWhJSrKY8KJKeVZ32mJZYVqwRkmX8XVKXRysxUxemL97IoSuT3G8U8iK5oZu/k6qe5OVQHtZxynWyQ6Q==
```

The [public GitHub release](https://github.com/yast-ai/convex-platforms/releases/tag/v0.1.4) includes both tutorial videos.
