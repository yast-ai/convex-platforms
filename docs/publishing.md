# Publishing Convex Platforms

`@disposabl/convex-platforms` is released from `main` by `.github/workflows/publish.yml` after a committed `package.json` version change. The workflow does not create a commit, tag, release, or version bump. This prevents a publish from triggering another publish cycle.

## Before the first release

1. Create the `disposabl` organization on npm and ensure the release maintainer has verified email and two-factor authentication.
2. Publish the reviewed initial version manually with `npm publish --access public`.
3. On that package's npm Settings page, configure a GitHub Actions trusted publisher with GitHub organization `yast-ai`, repository `convex-platforms`, and workflow filename `publish.yml`. Under **Allowed actions**, explicitly enable `npm publish`; new configurations otherwise allow only `npm stage publish`.

   Alternatively, after the package exists, npm 11.15+ can configure that same trust relationship:

   ```sh
   npm trust github @disposabl/convex-platforms --repo yast-ai/convex-platforms --file publish.yml --allow-publish --yes
   ```

   The first request still requires the maintainer's interactive two-factor authentication confirmation; `--yes` accepts ordinary prompts.

4. Complete the first trusted publish within two days, then set publishing access to require two-factor authentication and disallow tokens.

Trusted publishing uses GitHub-hosted Actions OIDC. It requires Node 22.14+ and npm 11.5.1+; the workflow uses Node 24 and verifies the npm version before publication. No npm write token or GitHub secret is used.

## Normal release

1. Update `version` in `package.json` and `CHANGELOG.md` in a reviewed change.
2. Merge it into `main`.
3. CI runs formatting, linting, type checks, tests, the build, and a packed-consumer check.
4. The publish workflow first asks npm whether that exact version already exists. It publishes only a missing version; registry errors fail the job instead of being interpreted as permission to publish.

Use **Run workflow** only to retry an unpublished version. It still runs all verification and skips a version already in npm. A failed OIDC or trusted-publisher configuration stays failed: it is not replaced with a token-based fallback.

## What the packed check proves

`bun scripts/verify-package.ts` packs the package and checks the tarball allowlist, exported and CLI artifacts, credential markers and private source imports, a fresh Node consumer import, and declaration compilation. It compiles packaged Python files when a generated Python SDK is present.

The check does not prove npm account authorization, marketplace approval, or production WorkOS/Convex behavior. Those require the relevant authenticated service and an explicit live verification.

## CLI and SDK distribution

The npm package is the shared runtime and CLI distribution. The `convex-platforms` bin is discovered from the package's `bin` field after npm installation. Generated TypeScript and Python SDKs are artifacts of the generator; they have their own package/repository and release lifecycle if they are published separately. Do not publish generated outputs accidentally through this package.

## Plugin packages

Plugins are application-level packaging, not a property selected per internal function. Keep the runtime package independent from host-specific manifests:

- ChatGPT/Codex portable packages use root `plugin.json`, root `skills/`, optional root `mcp.json`, and OpenAI-specific metadata under `extensions.com.openai`. ChatGPT and Codex share one public directory submission.
- Claude Code packages use `.claude-plugin/plugin.json`, typically `.mcp.json`, and a `.claude-plugin/marketplace.json` catalog. A Claude marketplace can source a plugin from npm, but it is not the OpenAI directory.

See OpenAI's [package guide](https://developers.openai.com/plugins/build/plugins), OpenAI's [submission guide](https://developers.openai.com/plugins/deploy/submission), and Anthropic's [plugin guide](https://code.claude.com/docs/en/plugins).
