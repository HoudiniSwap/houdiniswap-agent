# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MCP server + Vercel AI SDK tools that let AI agents discover, quote, and execute crypto swaps via the HoudiniSwap Partner API v2 (14 CEXes + 20+ DEXes). Distinguishing feature: x402 pay-per-request auth — agents pay per API call in USDC on Base, no signup.

## Commands

Run from the repo root (Turborepo orchestrates the workspaces):

```bash
npm install
npm run build          # turbo run build — tsc per package, respects ^build dependency order
npm run test           # turbo run test — depends on build first
npm run clean          # rm -rf dist in each package
```

Per-package and single-test (turbo has no test filtering, so cd into the package):

```bash
npm run test -w @houdiniswap/agent-shared       # one package via npm workspace
cd packages/shared && npx vitest run            # same, directly
cd packages/shared && npx vitest run -t "strips trailing slash"   # single test by name
cd packages/mcp-server && npx vitest watch      # watch mode
```

Run the MCP server locally:

```bash
node packages/mcp-server/dist/index.js                    # stdio (default; build first)
node packages/mcp-server/dist/index.js --transport=http   # HTTP on :8080, POST /mcp
```

Run the example agent (needs a wallet key + Anthropic creds):

```bash
WALLET_KEY=0x... ANTHROPIC_API_KEY=sk-ant-... npx tsx examples/swap-agent.ts "Swap 0.1 BTC to ETH"
```

Notes:
- `npm run lint` is wired in turbo but **no package defines a `lint` script** — it's currently a no-op. Type-checking happens only through `tsc` during `build`. There is no separate typecheck/format step.
- CI (`.github/workflows/ci.yml`) runs `npx turbo run build` then `npx turbo run test` on Node 20.

## Architecture

Three packages under `packages/`, all ESM (`"type": "module"`, `moduleResolution: NodeNext`):

- **`@houdiniswap/agent-shared`** — the foundation. Owns `HoudiniClient` (the only thing that talks to the API), all TypeScript types (`src/types.ts`), and the x402 fetch wrapper. The other two packages depend on it via `"@houdiniswap/agent-shared": "^0.1.0"` (resolved to the local workspace symlink during dev) and import only its public surface (`src/index.ts`). **It IS published to npm** — `mcp-server`'s `dist/index.js` imports `HoudiniClient` from it at runtime and does not bundle it, so a published `mcp-server` would 404 without `agent-shared` on the registry. Publish order: shared → mcp-server → ai-tools.
- **`@houdiniswap/mcp-server`** — MCP server exposing tools via `server.tool(...)`. `src/index.ts` is the CLI entrypoint (`bin`), `src/server.ts` wires up all tool modules + resources, and each `src/tools/*.ts` registers a group of related tools. It also registers two MCP resources (`src/resources/openapi.ts`): `houdiniswap://openapi` (fetched live from the API at request time) and `houdiniswap://pricing` (a hardcoded x402 pricing/rate-limit blurb, **not** sourced from SKILL.md).
- **`@houdiniswap/ai-tools`** — the same tools as Vercel AI SDK v6 `tool(...)` definitions. `createHoudiniTools(config)` builds a client and returns the tool map.

### The duplication you must respect

**The tool catalog exists twice** — once as MCP tools (`packages/mcp-server/src/tools/`) and once as AI SDK tools (`packages/ai-tools/src/tools.ts`). They are independent hand-written definitions over the same `HoudiniClient`, including the multi-step `swap` composite flow (in `mcp-server/src/tools/swap-flow.ts` AND inline in `ai-tools/src/tools.ts`). When you change a tool's behavior, parameters, or the swap flow logic, **update both packages** or they drift. The AI SDK side keeps its Zod input schemas in `packages/ai-tools/src/schemas.ts`; the MCP side defines Zod shapes inline in each tool file.

### HoudiniClient & auth

`HoudiniClient` (`packages/shared/src/client.ts`) is a thin `fetch` wrapper: `get(path, params)` builds a query string (skipping null/undefined, expanding arrays); `post(path, body)` sends JSON; both throw `HoudiniApiError` on non-2xx. Auth is a tagged union (`HoudiniAuth`): `apiKey` → `Authorization` header, `partnerId` → `partner-id` header, `x402` → swaps in the x402 fetch wrapper, `none` → no headers.

The MCP entrypoint resolves auth from env vars with this precedence (`packages/mcp-server/src/index.ts`): `HOUDINI_API_KEY` > `HOUDINI_X402_PRIVATE_KEY` > `HOUDINI_PARTNER_ID` > none. Base URL defaults to `https://api-partner.houdiniswap.com/v2` (override with `HOUDINI_API_URL`).

### x402 payment flow

`createX402Fetch` (`packages/shared/src/x402.ts`) returns a `fetch` that intercepts `402 Payment Required`, signs a gasless USDC `transferWithAuthorization` (EIP-3009) via `@x402/*` + `viem`, and retries with payment headers. **It enforces a 5-second minimum gap between payments** (`MIN_PAYMENT_INTERVAL_MS`) to avoid EIP-3009 nonce collisions — so rapid sequential paid calls (e.g. the multi-step `swap` flow) are deliberately throttled and can feel slow. This is intentional; don't "fix" it by removing the delay.

## Conventions

- **Import paths use `.js` extensions even for `.ts` sources** (NodeNext requirement) — e.g. `import { HoudiniClient } from "./client.js"`. Always do this for new files.
- **Token identity:** the API needs token `id` (Mongo ObjectId), never raw symbols, for quotes/exchanges. When resolving a symbol, prefer `mainnet: true` tokens over chain-specific variants (whose `cexTokenId` like `"ETHETH"` CEX providers may reject). See `pickToken` in `swap-flow.ts`.
- **CEX vs DEX:** the composite `swap` tool filters to CEX quotes only (`q.type !== "dex"`) because DEX swaps need `addressFrom` and external on-chain signing. The MCP server's x402 key is for API payments ONLY — never use it to sign DEX transactions; DEX tools return unsigned tx data for the user to sign externally.
- **Tool results:** MCP tools return `{ content: [{ type: "text", text: JSON.stringify(...) }] }` and set `isError: true` on failures (returning an error object rather than throwing). AI SDK tools return the raw parsed object directly.
- **Tests** are vitest, colocated in each package's `__tests__/`, and mock `fetch` / the x402 module rather than hitting the network.

## SKILL.md vs. actual tool params

`plugins/houdiniswap/skills/houdiniswap/SKILL.md` is a system-prompt-style instruction doc shipped to end agents — the skill bundled in the `houdiniswap` Claude Code plugin (distributed via the `.claude-plugin/marketplace.json` marketplace in this repo; manual copy to `~/.claude/skills/` also works). It is **not** wired into any MCP resource. It documents idealized behavior and **can lag the real tool signatures** — e.g. it describes `dexApprove`/`dexCheckAllowance` taking `addressFrom`, but the actual tools (`dex.ts`, `schemas.ts`) take `address`; it describes `dexConfirmTx` taking `id`, but the code takes `quoteId`. **Trust `packages/*/src/` for parameter names**, not SKILL.md. If you change tool params, update SKILL.md too.

## Releasing

All three packages publish to npm under `@houdiniswap` (`shared` included — it's a runtime dependency of the other two), in order shared → mcp-server → ai-tools. Separately, **this repo is also a Claude Code plugin marketplace**: `.claude-plugin/marketplace.json` lists the `houdiniswap` plugin under `plugins/houdiniswap/`, whose `plugin.json` bundles the skill plus an MCP server entry (`npx -y @houdiniswap/mcp-server`). Users install with `/plugin marketplace add HoudiniSwap/houdiniswap-agent` then `/plugin install houdiniswap@houdiniswap`. Versioning, npm publish, and plugin validate/install steps are all in `PUBLISHING.md`.
