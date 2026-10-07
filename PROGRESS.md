# Release progress

Convex Platforms: `@disposabl/convex-platforms`, https://github.com/yast-ai/convex-platforms. Source checkout: `/private/tmp/portloom`. The fifteen-minute follow-through heartbeat remains active.

## Published and verified

- npm 0.1.1 was published automatically through GitHub trusted publishing at source `68ea3c0`. Publication run `37598838964` and matching CI `37598838926` passed. Signed provenance is present. No long-lived npm token is used.
- A fresh registry consumer installed the package, generated three actual native Convex operations, checked freshness and ran the installed CLI.
- Native typed internal builders, generated contracts, authenticated API/MCP, rotating private CLI sessions, TypeScript/Python SDKs, MCP Apps bundling, initializer and project-level plugin packaging are implemented. Independent reviews and 43 tests passed, including official MCP client and real TypeScript/Python network transports. Packed-consumer export, declaration and command checks passed.
- Live development demo: `yast-ai/convex-platforms-demo`, deployment `hip-lark-939`. Managed WorkOS, CIMD and its exact `/mcp` resource are configured. API, installed CLI and both SDKs completed create/list/delete. Identity forgery returned 400, cross-organization deletion returned 404, invalid text returned 400, and other-organization reads were empty. Membership revocation returned 401 and reactivation restored 200.
- Real WorkOS CLI device authorization completed in Chrome. Registry CLI CRUD, rotating refresh, stable organization, refresh-only private storage (0700 directory / 0600 file), logout and post-logout denial passed.
- Optional React MCP Apps example was bundled and typechecked, then visibly checked in a labeled browser mock at desktop and 390px mobile sizes in light/dark themes. Example CI gate passed in run `37601311105` at `f947f15`.
- Real onboarding captures include QA's unconnected WorkOS plus button, its Create WorkOS Workspace dialog, and Yast's connected Active integration. The QA dialog's button appearance alone was edited with image generation and is explicitly labeled. The connected capture is from a different team. QA was not connected: its only eligible email is already used, and the user declined adding another email.

## Work in progress

- Final screenshot-based setup tour revision uses the three requested captures in order. The original 90-second diagram walkthrough is also available. Neither is described as a continuous dashboard recording.
- Release 0.1.2 will publish the corrected onboarding preflight, device-flow and host-specific plugin instructions, screenshots and finished tour links. Sync the durable checkout `/Users/vivekbezawada/Projects/convex-platforms` after pushing.
- At the user's explicit request, the runtime agent now owns migration of TinyAPK's current main-branch uncommitted platform implementation to the published npm package. Preserve unrelated changes and a recoverable private snapshot. Do not commit or push the application's uncommitted work.
- Real WorkOS Connect MCP OAuth authorization and native ChatGPT/Claude plugin installation with a live tool/UI interaction remain unverified. Protocol tests and browser mocks do not replace these checks.

Private test credentials are restricted to `/private/tmp/convex-platforms-demo` and must never be committed, copied into docs, or displayed. Root owns Chrome exclusively; agents work in separate scoped checkouts. Notify only meaningful progress, completion, failure or necessary human input. Never claim production readiness from dry runs or green CI alone.
