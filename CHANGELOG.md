# Changelog

## 0.1.4

- Resolve TypeScript path aliases when bundling MCP widgets, allowing shared application components to retain their existing imports.
- Verify alias resolution together with compiled Tailwind styles and isolated build configuration. Bundle TinyAPK's actual shared-component widget as a consumer compatibility check.

## 0.1.3

- Bundle existing Tailwind v4 MCP widgets using the optional `@tailwindcss/vite` plugin.
- Keep widget builds isolated from application Vite and PostCSS configuration; verify actual compiled utility styles in a regression test.

## 0.1.2

- Add dashboard onboarding screenshots and a setup tour, including the unconnected integration, workspace dialog and connected integration steps. Label the edited dialog button and separate teams.
- Require all WorkOS settings before the first package-enabled deployment in the README and generated setup instructions.
- Type the generated JSON manifest in the initializer and example so new Convex projects pass TypeScript checks.
- Correct first-party CLI device authorization and host-specific OpenAI/Claude plugin installation instructions. Record real device login, refresh and logout verification.
- Verify the optional MCP Apps example in CI and before publishing, including its types and self-contained HTML bundle.

## 0.1.1

- Document the npm CLI command for configuring GitHub trusted publishing, including its direct publishing permission and interactive authentication requirement.
- Verify the release workflow with an automatic publication triggered by the package version change.

## 0.1.0

- Initial public release of native Convex internal builders, generated authenticated API/MCP interfaces, shared CLI, TypeScript/Python SDK generation, optional MCP Apps packaging, and project-level OpenAI/Claude plugin bundles.
- Include onboarding guides, organization-scoped examples, security guidance, setup diagrams, a rendered walkthrough, tests and deployment evidence.
