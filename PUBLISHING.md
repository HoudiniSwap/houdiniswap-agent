# Publishing Guide

## Prerequisites

1. npm account with access to `@houdiniswap` org
2. GitHub repo is public (switch from private when ready)
3. All tests passing: `npm run test`
4. Production backend deployed with x402 enabled

## Pre-Publish Checklist

- [ ] All 46 tests passing (`npm run test`)
- [ ] E2E verified on production (`api-partner.houdiniswap.com`)
- [ ] x402 facilitator running on production
- [ ] Default partner migration run on production DB
- [ ] README updated with production URLs
- [ ] Version numbers set in all `package.json` files

## Step 1: Create npm Organization

```bash
# Login to npm
npm login

# Create the @houdiniswap org (if not exists)
npm org create houdiniswap
```

## Step 2: Build All Packages

```bash
npm run build
npm run test
```

## Step 3: Publish Shared Package (Internal)

The shared package is `private: true` and used as a workspace dependency.
It doesn't need to be published to npm.

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

After publishing, verify:
```bash
npx @houdiniswap/mcp-server --help
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

## Step 7: Publish Skill

The Claude Code skill at `skill/SKILL.md` can be shared by pointing users to the repo:

```bash
# Users install the skill by adding the MCP server:
claude mcp add houdiniswap -- npx @houdiniswap/mcp-server

# The skill instructions are automatically available via the MCP resource:
# houdiniswap://pricing
```

Or users can manually add the skill:
```bash
# Copy skill/SKILL.md to ~/.claude/skills/houdiniswap.md
cp skill/SKILL.md ~/.claude/skills/houdiniswap.md
```

## Step 8: Update Documentation

After publishing, update the docs at `houdiniswap-backend/docs/v2/`:
- Replace `npx @houdiniswap/mcp-server` examples with the published version
- Add npm badges to README
- Update changelog

## Version Bumping

```bash
# Patch (bug fixes)
npm version patch -w packages/mcp-server -w packages/ai-tools

# Minor (new features)
npm version minor -w packages/mcp-server -w packages/ai-tools

# Then rebuild and publish
npm run build
cd packages/mcp-server && npm publish --access public
cd ../ai-tools && npm publish --access public
```

## Rollback

If a published version has issues:
```bash
# Unpublish within 72 hours
npm unpublish @houdiniswap/mcp-server@0.1.0

# Or deprecate (preferred)
npm deprecate @houdiniswap/mcp-server@0.1.0 "Known issue, use 0.1.1"
```
