# Convex Platforms

Public npm library by Yast AI. Use Bun; install with `bun install --frozen-lockfile` after the lockfile exists.
Keep runtime imports independent from generation/Node/build tooling. Functions remain native internal Convex functions in the consuming app.
Authenticate at the edge; reject client identity; forward flat `orgId`, `userId`, `role`, then operation args. Resolve current WorkOS membership. Never add synthetic auth or store credentials in widgets/generated code.
Plugins are app-level packaging, separate from per-function platform selection. Do not imply official Convex, WorkOS, OpenAI or Anthropic ownership or automatic marketplace approval.
After code batches run format, lint, typecheck, tests and build. Verify packed installs and generated clients. Public docs must distinguish live verification, offline testing and user authentication prerequisites.
Reusable WorkOS account/team operations belong in the optional workos export. Do not copy application-specific business operations, secrets, generated deployment data or private assets.
