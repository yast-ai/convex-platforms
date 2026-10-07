# Contributing

Use Bun and install dependencies with `bun install --frozen-lockfile`. Before opening a pull request, run:

```sh
bun run format
bun run lint
bun run typecheck
bun test
bun run build
bun scripts/verify-package.ts
```

Keep runtime imports independent from generation and build tooling. Do not add generated deployment data, credentials, customer data, or application-specific account logic. Public API changes need documentation and a version update planned by a maintainer.
