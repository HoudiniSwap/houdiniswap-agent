# Distribution: npm + Claude Code Marketplace

Overview of how `houdiniswap-agent` is distributed, and the changes made to enable it.
For the step-by-step release runbook, see [`PUBLISHING.md`](./PUBLISHING.md).

## Two distribution paths

1. **npm** — `@houdiniswap/mcp-server` (and `@houdiniswap/ai-tools`), so agents can run
   `npx -y @houdiniswap/mcp-server`.
2. **Claude Code plugin marketplace** — one plugin that bundles **both** the swap skill
   (`SKILL.md`) **and** the MCP server config. This repo *is* the marketplace.

## What was set up

### npm path — unblocked `npx @houdiniswap/mcp-server`
- `packages/shared/package.json` → added `publishConfig.access: public`. `agent-shared` **must**
  be published: `mcp-server/dist/index.js` imports `HoudiniClient` from it at runtime and does not
  bundle it, so a published `mcp-server` would 404 / `ERR_MODULE_NOT_FOUND` without it on the registry.
- `mcp-server` + `ai-tools` → dependency pinned `"@houdiniswap/agent-shared": "*"` → `"^0.1.0"`
  (npm does **not** rewrite plain `"*"` on publish — only the `workspace:` protocol gets rewritten —
  so `*` would 404 at consumer install). Both also got `publishConfig.access: public`.
- Verified: `npm install` relinks the workspace, `npm run build` green, **all 46 tests pass**,
  `npm pack --dry-run` shows clean `dist`-only tarballs.

### Claude marketplace path — one plugin = skill + MCP server
- `plugins/houdiniswap/skills/houdiniswap/SKILL.md` — the skill was relocated here from `skill/SKILL.md`
  and given the **required YAML frontmatter** (`name` + `description`); content preserved exactly.
- `plugins/houdiniswap/.claude-plugin/plugin.json` — manifest that also bundles the MCP server
  (`npx -y @houdiniswap/mcp-server`).
- `.claude-plugin/marketplace.json` — the marketplace catalog (this repo is the marketplace).
- Verified: `claude plugin validate .` → **Validation passed** (clean).

### Docs corrected
`README.md`, `PUBLISHING.md`, `CLAUDE.md`: added `-y` to all `npx` calls, replaced the wrong
"shared doesn't need publishing" and "skill = pricing resource" claims, fixed the broken `--help`
verify step, and documented the plugin-install flow and the shared → mcp-server → ai-tools publish order.

## How users install (both work once published)

```bash
# MCP server only:
claude mcp add houdiniswap --env HOUDINI_X402_PRIVATE_KEY=0x... -- npx -y @houdiniswap/mcp-server

# Skill + MCP server via marketplace:
/plugin marketplace add HoudiniSwap/houdiniswap-agent
/plugin install houdiniswap@houdiniswap        # plugin@marketplace
```

## Remaining manual steps (require credentials)

1. `npm login` (access to the `@houdiniswap` org).
2. Publish **in order**: `cd packages/shared && npm publish` → `mcp-server` → `ai-tools`.
3. Make the GitHub repo public.
4. Push — the marketplace goes live immediately (Git-based; the plugin itself is not published to npm).

## Notes

- The `bin` is named `houdiniswap-mcp`, but since it's the package's only bin,
  `npx @houdiniswap/mcp-server` resolves to it — no rename needed.
- The plugin prompts for the x402 key via a `userConfig` block in `plugin.json` and passes it to the
  server as `HOUDINI_X402_PRIVATE_KEY`. It is marked `sensitive`, so Claude Code masks the input and
  stores it in the OS keychain rather than `settings.json`. Both `0x`-prefixed and bare 64-hex keys
  are accepted, since MetaMask exports without the prefix.
- The MCP server starts without a key, but it cannot fetch anything: `GET /status` is the only public
  route and no tool maps to it, so every tool returns 402. "Read-only mode" means the process comes up
  cleanly, not that lookups work. A malformed or unsubstituted key is ignored with a warning on stderr
  rather than crashing the server (see `packages/mcp-server/src/auth.ts`).
- Tool responses are shaped for agents, not browsers (`packages/mcp-server/src/shape.ts`): token
  descriptions and icons are stripped, and `getQuote` keeps the best 5 per type while reporting how
  many it omitted. Pass `verbose: true` to any tool for the raw API response.
