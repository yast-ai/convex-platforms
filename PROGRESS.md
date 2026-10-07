# Release progress

Convex Platforms is published as `@disposabl/convex-platforms` from [yast-ai/convex-platforms](https://github.com/yast-ai/convex-platforms).

## Verified

- Version 0.2.1 is downloadable from the public npm registry. [CI](https://github.com/yast-ai/convex-platforms/actions/runs/37621336189) and [actual trusted publication](https://github.com/yast-ai/convex-platforms/actions/runs/37621336274) passed at `c10140e6b38801cf637a638a16307631e73d3885`. The downloaded tarball matched registry SHA-512 integrity and [signed provenance](https://search.sigstore.dev/?logIndex=3131090494) was recorded.
- One-file WorkOS selection, optional public aliases, custom native replacements and per-operation interface selection are verified. All 90 tests passed with 314 assertions, independent review found no blockers, and fresh packed-consumer verification passed. Two development consumers compiled and deployed; 17 live disposable WorkOS checks passed with cleanup. Exact registry installs passed frozen dependency and generation checks. See the [one-file guide](docs/workos.md).

- Version 0.2.0 is downloadable from the public npm registry. Its actual [trusted publication](https://github.com/yast-ai/convex-platforms/actions/runs/37619241340) and [matching CI](https://github.com/yast-ai/convex-platforms/actions/runs/37619241391) passed at `0eaaecd356122aee1b902e5970684e059dace021`, with signed provenance and no long-lived npm publishing token. The downloaded tarball matched its registry integrity; a fresh registry installation imported the new WorkOS module and verified registry signatures and attestations.
- The optional `./workos` export supplies all 14 reusable account, team, member, invitation and user API-key operations, including native public/internal functions, validators and provider pagination. It also handles signed webhooks with optional personal-account provisioning. All 74 package tests passed; an independent security review passed the 30 new operation/webhook tests. Two development consumers deployed successfully, and 17 live disposable WorkOS checks passed with cleanup completed. See [WorkOS integration](docs/workos.md).
- Native internal builders, generated contracts, authenticated API/MCP, private rotating CLI sessions, TypeScript/Python SDKs, MCP Apps bundling, initializer and project-level plugin packaging are implemented. Tests include the official MCP client, isolated Tailwind and TypeScript alias bundling, and real TypeScript/Python network transports.
- Packed-consumer exports, declarations, initialized-project typechecking, native generation and command execution passed. The optional React example is verified in CI and before publishing.
- Live development API, CLI and both SDK create/list/delete checks passed, including identity rejection, organization isolation and membership revocation. Real WorkOS device login, refresh rotation, stable organization, private storage, logout and post-logout denial passed.
- The 74-second screenshot-based setup tour and 90-second diagram walkthrough are attached to [release v0.1.4](https://github.com/yast-ai/convex-platforms/releases/tag/v0.1.4). The setup tour shows an actual unconnected QA integration, its dialog with only the button appearance edited, and an actual connected Yast integration. The edit and separate teams are labeled.

## Remaining interactive verification

Real WorkOS Connect MCP OAuth authorization and native ChatGPT/Claude plugin installation with a live tool/UI interaction remain unverified. Protocol tests and browser mocks do not replace these checks. The live OAuth test requires approval of the concrete test-client grant before it runs.

See [release evidence](docs/release-evidence.md) for executed checks and their limits.
