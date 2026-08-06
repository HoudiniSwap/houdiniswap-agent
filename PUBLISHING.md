# Publishing Guide

## Releases are automatic

**To release: bump the version in the package's `package.json` in your PR, and merge to `main`.**
`.github/workflows/publish.yml` builds, tests, and then publishes only the packages whose version
differs from the registry, in dependency order (`agent-shared` → `mcp-server` → `ai-tools`).
Merging a PR that touches no version publishes nothing.

Auth is npm **trusted publishing** (OIDC): npm trusts the workflow's identity, so there is no
`NPM_TOKEN` to store or rotate and the account's hardware security key is never involved — which
is what made manual publishing awkward, since the browser approval needs a real TTY. Provenance
attestations are generated automatically.

One-time setup on npmjs.com, **per package** (`agent-shared`, `mcp-server`, `ai-tools`):

> Package → Settings → Trusted Publisher → GitHub Actions
> - Organization or user: `HoudiniSwap`
> - Repository: `houdiniswap-agent`
> - Workflow filename: `publish.yml`
> - Allowed actions: `npm publish`

Until a package has this configured, the workflow fails on that package. Requires npm >= 11.5.1
and Node >= 22.14.0, both pinned in the workflow.

The rest of this document is the **manual fallback** — for the first publish of a brand-new
package, or if CI is unavailable.

## Prerequisites

1. npm account with access to `@houdiniswap` org
2. GitHub repo is public (switch from private when ready)
3. All tests passing: `npm run test`
4. Production backend deployed with x402 enabled

## Pre-Publish Checklist

- [ ] All tests passing (`npm run test`)
- [ ] E2E verified on production (`api-partner.houdiniswap.com`)
- [ ] x402 facilitator running on production
- [ ] Default partner migration run on production DB
- [ ] README updated with production URLs
- [ ] Version numbers set in all `package.json` files

## Step 1: Create npm Organization

The org must be created on the website — the npm CLI has no `org create` subcommand (only
`npm org set|rm|ls`). Go to https://www.npmjs.com/org/create and register `houdiniswap`; the
scope has to match the org name exactly. Then log in and confirm membership:

```bash
npm login                    # browser-based; the account needs 2FA to publish
npm whoami
npm org ls houdiniswap
```

## Step 2: Build All Packages

```bash
npm run build
npm run test
```

## Step 3: Publish Shared Package

`@houdiniswap/agent-shared` **must** be published. `mcp-server` and `ai-tools` import it at
runtime (`import { HoudiniClient } from "@houdiniswap/agent-shared"`), so `npx @houdiniswap/mcp-server`
fails with a 404 / `ERR_MODULE_NOT_FOUND` if it isn't on the registry. It carries
`publishConfig.access: public`, and the dependents pin it to a caret range on the current minor (not `*`).

```bash
cd packages/shared
npm publish --dry-run     # access:public comes from publishConfig
npm publish
```

**Publish order matters: shared → mcp-server → ai-tools** — the dependents must resolve the
just-published `agent-shared` version. Keep all three versions in lockstep.

## Step 4: Publish MCP Server

```bash
cd packages/mcp-server

# Verify package.json has correct version
cat package.json | grep version

# Dry run first
npm publish --access public --dry-run

# Publish
npm publish --access public
```

After publishing, verify it boots (prints `HoudiniSwap MCP server (stdio) ready`, then Ctrl-C):
```bash
npx -y @houdiniswap/mcp-server
```

## Step 5: Publish AI SDK Tools

```bash
cd packages/ai-tools

# Dry run
npm publish --access public --dry-run

# Publish
npm publish --access public
```

## Step 6: Make Repo Public

1. Go to https://github.com/HoudiniSwap/houdiniswap-agent/settings
2. Scroll to "Danger Zone"
3. Click "Change visibility" → Public

## Step 7: Publish the Claude Code Plugin (Skill + MCP)

This repo doubles as a plugin marketplace. The catalog lives at `.claude-plugin/marketplace.json`
and the plugin at `plugins/houdiniswap/` — its `plugin.json` bundles the swap skill
(`plugins/houdiniswap/skills/houdiniswap/SKILL.md`) and an MCP server entry that runs
`npx -y @houdiniswap/mcp-server`.

The plugin is **distributed via Git, not npm** — no `npm publish` for the plugin itself. Once the
repo is public (Step 6) and `@houdiniswap/mcp-server` is on npm (Step 4), users install with:

```bash
/plugin marketplace add HoudiniSwap/houdiniswap-agent
/plugin install houdiniswap@houdiniswap        # plugin@marketplace
```

That single install delivers the skill (`/houdiniswap:houdiniswap`) **and** wires up the MCP server.

Before pushing, validate locally:
```bash
claude plugin validate .
```

When you change the skill or MCP config, bump `version` in
`plugins/houdiniswap/.claude-plugin/plugin.json` and push; users refresh with
`/plugin marketplace update houdiniswap`.

**Manual install (no plugin):** copy the skill file directly:
```bash
cp plugins/houdiniswap/skills/houdiniswap/SKILL.md ~/.claude/skills/houdiniswap.md
```

**Optional — official/community marketplace:** for wider reach, submit at
https://platform.claude.com/plugins/submit once `claude plugin validate .` passes.

## Step 8: Update Documentation

After publishing, update the docs at `houdiniswap-backend/docs/v2/`:
- Replace `npx @houdiniswap/mcp-server` examples with the published version
- Add npm badges to README
- Update changelog

## Version Bumping

Dependents pin `agent-shared` at a caret range on its current version, so while it is pre-1.0 a **minor** bump of
shared also requires updating that range in `mcp-server`/`ai-tools`.

```bash
# Patch (bug fixes)
npm version patch -w packages/shared -w packages/mcp-server -w packages/ai-tools

# Minor (new features)
npm version minor -w packages/shared -w packages/mcp-server -w packages/ai-tools

# Then rebuild and publish in order: shared → mcp-server → ai-tools
npm run build
cd packages/shared && npm publish
cd ../mcp-server && npm publish
cd ../ai-tools && npm publish
```

> `--access public` is no longer needed on the CLI — all three packages set
> `publishConfig.access: "public"`.

## Rollback

If a published version has issues:
```bash
# Unpublish within 72 hours
npm unpublish @houdiniswap/mcp-server@0.1.0

# Or deprecate (preferred)
npm deprecate @houdiniswap/mcp-server@0.1.0 "Known issue, use 0.1.1"
```
