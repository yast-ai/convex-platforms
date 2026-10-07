# Changelog

## 0.2.1

- Configure and select WorkOS account/team operations in one Convex file with flat `functions` and optional `publicFunctions` exports; existing grouped exports remain supported.
- Preserve logical API, MCP, CLI and SDK resource names independently of physical Convex modules through validated `resource` metadata; native function references keep the actual module path.
- Allow custom native operations to replace omitted builtins, and configure builtin interface selection per operation with `operationPlatforms`.
- Verify one-file selection, omitted operations, custom replacements, resource validation, collisions and packed consumer declarations/discovery.

## 0.2.0

- Add reusable native Convex account, team, membership, invitation and user API-key operations through the optional `./workos` export, including public wrappers and boundary validators.
- Configure role priorities, administrative roles, invitation defaults, trusted first-party session issuers and personal organization policy per application.
- Add a signed WorkOS webhook handler with optional personal organization provisioning, conflict replay and synchronization after successful provisioning.
- Verify native registration, authentication and organization isolation with `convex-test`, plus packed consumer types and discovery.

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
