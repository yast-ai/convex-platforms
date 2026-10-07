# Project-level plugins

A plugin packages how to use your application: curated skills, an MCP endpoint and host-specific metadata. It does not create another platform-selection flag and does not expose API-only functions.

Use `platforms: { mcp: true }` or `platforms: true` on the relevant internal functions. Generate the contract, put curated skills in the app's `skills/` directory, and run:

```sh
bunx convex-platforms plugins --name my-app --site-url https://YOUR-DEPLOYMENT.convex.site
```

The command creates `plugins/openai` with portable `plugin.json`, `mcp.json` and `skills/`, and `plugins/claude` with `.claude-plugin/plugin.json`, `.mcp.json` and `skills/`. Both reference the same authenticated `/mcp` endpoint. It refuses to overwrite an existing curated bundle.

## Local testing

The generated OpenAI directory is a portable package for ChatGPT and Codex, but packaging does not install or authorize its remote MCP server. For current ChatGPT testing, open **ChatGPT Plugins**, choose the plus button, **Add custom MCP server**, enter the authenticated `/mcp` server URL and its connection details, accept the risk notice, then choose **Create as a plugin**. Open that plugin, select the plus button to install it, start a new **Work** chat, and select the plugin with `@` before performing a live operation. See the [OpenAI testing quickstart](https://developers.openai.com/plugins/quickstart).

For local Codex development, add a repository marketplace at `.agents/plugins/marketplace.json` pointing to `./plugins/openai`, restart the desktop app, then install and authorize it in Codex. The portable `plugin.json` and `mcp.json` layout is valid for ChatGPT and Codex; use the [OpenAI packaging instructions](https://developers.openai.com/plugins/build/plugins) for the current schema and marketplace rules.

For Claude Code, use `plugins/claude`: it needs its own `.claude-plugin/plugin.json` and `.mcp.json`, and is installed through a Claude Code marketplace or a local plugin directory. Run `claude plugin validate plugins/claude`, install it, complete OAuth, and perform a live operation. Claude.ai and Cowork have a separate distribution path and supported-component set; a Claude Code marketplace/plugin is not evidence that it works there. See the [Claude Code plugin overview](https://code.claude.com/docs/en/plugins) and [marketplace guide](https://code.claude.com/docs/en/plugin-marketplaces).

A parsed manifest or successful raw MCP request does not prove a plugin installs or its UI works.

## Public distribution

Version plugin bundles at the application level. Submit the OpenAI bundle using its public [submission process](https://developers.openai.com/plugins/deploy/submission). Add the Claude bundle to the appropriate marketplace. Public listing requires application-owned support and policy links and review by the host provider.

The npm library cannot submit every consuming application to a directory. Generated default skills are starting points: replace them with precise workflows, authorization boundaries and error handling for your app.
