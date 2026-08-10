# HoudiniSwap Agent

MCP Server + AI SDK Tools for [HoudiniSwap](https://houdiniswap.com) — agent-friendly crypto swap aggregation with x402 pay-per-use.

## What is this?

HoudiniSwap aggregates 14 CEXes and 20+ DEXes across multiple blockchains. This repo provides agent integration tools so AI assistants can discover, quote, and execute swaps programmatically.

**Three published packages:**

| Package | Description | Install |
|---------|-------------|---------|
| `@houdiniswap/mcp-server` | MCP server for Claude, Cursor, ChatGPT | `npx -y @houdiniswap/mcp-server` |
| `@houdiniswap/ai-tools` | Vercel AI SDK v6 tool definitions | `npm install @houdiniswap/ai-tools` |
| `@houdiniswap/agent-shared` | Shared HTTP + x402 client. A runtime dependency of the other two — installed automatically, not used directly. | — |

## Quick Start — MCP Server

### With x402 (no signup needed)

Pay per request with USDC on Base. No API key registration required.

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "houdiniswap": {
      "command": "npx",
      "args": ["-y", "@houdiniswap/mcp-server"],
      "env": {
        "HOUDINI_X402_PRIVATE_KEY": "0xYOUR_WALLET_PRIVATE_KEY"
      }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "houdiniswap": {
      "command": "npx",
      "args": ["-y", "@houdiniswap/mcp-server"],
      "env": {
        "HOUDINI_X402_PRIVATE_KEY": "0xYOUR_WALLET_PRIVATE_KEY"
      }
    }
  }
}
```

**Claude Code — MCP server only:**
```bash
claude mcp add houdiniswap --env HOUDINI_X402_PRIVATE_KEY=0x... -- npx -y @houdiniswap/mcp-server
```

**Claude Code — plugin (skill + MCP server in one install):**
```bash
/plugin marketplace add HoudiniSwap/houdiniswap-agent
/plugin install houdiniswap@houdiniswap
```
Installs the HoudiniSwap swap-agent skill **and** wires up the MCP server. Claude Code prompts for your x402 wallet key at enable time and stores it outside `settings.json`. Where exactly depends on the platform — on Linux it is written to `~/.claude/.credentials.json` (mode 0600, plaintext), not an OS keychain. Treat the machine as able to read the key, and use a wallet funded with only what you intend to spend.

A funded wallet is **required** — the API is pay-per-call and only `GET /status` is free, so without a key every tool returns 402. Fund a wallet with a couple of dollars of USDC on Base and you're set; no gas needed, payments are gasless EIP-3009 authorizations settled by the facilitator.

### With API Key (for partners)

```json
{
  "env": {
    "HOUDINI_API_KEY": "YOUR_PARTNER_ID:YOUR_SECRET"
  }
}
```

### HTTP Transport (for remote agents)

```bash
npx -y @houdiniswap/mcp-server --transport=http
# Listens on port 8080 (override with PORT env var)
```

## Available Tools

### Core Tools

| Tool | Cost (x402) | Description |
|------|-------------|-------------|
| `getTokens` | $0.0001 | Search tokens by symbol, chain, address |
| `getChains` | $0.0001 | List supported blockchains |
| `getSwapProviders` | $0.0001 | List CEX + DEX providers |
| `getMinMax` | $0.0001 | Min/max amounts for a token pair |
| `getQuote` | $0.001 | Get swap quotes from multiple providers |
| `createExchange` | $0.01 | Create a swap order |
| `getOrder` | $0.0001 | Check order status |
| `getOrders` | $0.0001 | List orders with filters |

### DEX Tools

| Tool | Cost | Description |
|------|------|-------------|
| `dexApprove` | $0.0001 | Get token approval data |
| `dexCheckAllowance` | $0.0001 | Check token allowance |
| `dexConfirmTx` | $0.01 | Confirm DEX transaction |
| `dexChainSignatures` | $0.0001 | Multi-step signature chain |
| `dexSignRequest` | $0.0001 | Open a loopback page so the user signs the swap in their own browser wallet (EVM) |
| `dexSignStatus` | free | Poll for the result of that signature |

`dexSignRequest` is how a user should sign a DEX swap: it serves a page on `127.0.0.1` and hands
the transaction to their wallet, so no private key is ever pasted anywhere. EVM only, and it signs
the swap rather than the approval — the approval happens before an order exists. See
[docs/local-signing.md](docs/local-signing.md).

### Composite Tool

| Tool | Cost | Description |
|------|------|-------------|
| `swap` | ~$0.012 | Full swap flow: find tokens, validate amount, get best quote, create exchange |

## x402 Pay-Per-Use

The x402 protocol enables pay-per-request API access with USDC on Base. No account registration needed — just a wallet with USDC.

**How it works:**
1. Agent makes a request → gets `402 Payment Required`
2. Agent signs a USDC `transferWithAuthorization` (gasless, EIP-3009)
3. Agent retries with payment proof → gets the data

**Costs:** A complete swap flow costs ~$0.012 USDC (~1.2 cents).

**Rate limit:** 60 requests/minute per payer address.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HOUDINI_X402_PRIVATE_KEY` | One of these | — | EVM wallet private key for x402 payments |
| `HOUDINI_API_KEY` | One of these | — | Partner API key (`id:secret`) |
| `HOUDINI_PARTNER_ID` | One of these | — | Public partner ID (read-only access) |
| `HOUDINI_API_URL` | No | `https://api-partner.houdiniswap.com/v2` | API base URL |
| `PORT` | No | `8080` | HTTP transport port |

None is strictly required — the server starts without any of them, but every tool then returns 402. Precedence is `HOUDINI_API_KEY` → `HOUDINI_X402_PRIVATE_KEY` → `HOUDINI_PARTNER_ID`.

**Paid calls are spaced ~5 seconds apart.** The facilitator settles each payment on-chain and two settlements at once from the same wallet fail, so the client serialises them. A full swap flow takes 20-30 seconds; a single call that seems to hang for 5s is doing this, not stalling. Individual payments time out after 60s.

## Development

```bash
# Install
npm install

# Build
npm run build

# Test
npm run test

# Run MCP server locally (stdio)
node packages/mcp-server/dist/index.js
```

## Resources

- [QA test guide](docs/qa-test-guide.md) — install, then 15 cases covering every feature, with measured costs and minimums
- [Browser signing design](docs/local-signing.md) — how DEX signing works, and its threat model
- [HoudiniSwap API Docs](https://docs.houdiniswap.com/api-reference/)
- [x402 Payments Guide](https://docs.houdiniswap.com/docs/v2/x402-payments)
- [x402 Protocol (Coinbase)](https://docs.cdp.coinbase.com/x402/welcome)
- [MCP Specification](https://modelcontextprotocol.io/)

## License

MIT
