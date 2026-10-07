# Project-level plugins

A plugin packages how to use your application: curated skills, an MCP endpoint and host-specific metadata. It does not create another platform-selection flag and does not expose API-only functions.

Use `platforms: { mcp: true }` or `platforms: true` on the relevant internal functions. Generate the contract, put curated skills in the app's `skills/` directory, and run:

```sh
bunx convex-platforms plugins --name my-app --site-url https://YOUR-DEPLOYMENT.convex.site
```

The command creates `plugins/openai` with portable `plugin.json`, `mcp.json` and `skills/`, and `plugins/claude` with `.claude-plugin/plugin.json`, `.mcp.json` and `skills/`. Both reference the same authenticated `/mcp` endpoint. It refuses to overwrite an existing curated bundle.

## Local testing

For OpenAI, add a repository marketplace at `.agents/plugins/marketplace.json` pointing to `./plugins/openai`, then install and authorize it in the intended desktop host. Use the current [OpenAI packaging instructions](https://developers.openai.com/plugins/build/plugins) for the marketplace schema and restart requirements.

For Claude, use its plugin development/install workflow with `plugins/claude` and run `claude plugin validate` when Claude Code is installed. Install, complete OAuth and perform a live operation. [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference).

A parsed manifest or successful raw MCP request does not prove a plugin installs or its UI works.

## Public distribution

Version plugin bundles at the application level. Submit the OpenAI bundle using its public [submission process](https://developers.openai.com/plugins/deploy/submission). Add the Claude bundle to the appropriate marketplace. Public listing requires application-owned support and policy links and review by the host provider.

The npm library cannot submit every consuming application to a directory. Generated default skills are starting points: replace them with precise workflows, authorization boundaries and error handling for your app.
