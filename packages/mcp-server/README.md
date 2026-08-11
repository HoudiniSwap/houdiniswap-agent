# @houdiniswap/mcp-server

MCP server for [HoudiniSwap](https://houdiniswap.com) — crypto swap aggregation across 14 CEXes and
20+ DEXes, paid per call in USDC on Base via [x402](https://docs.cdp.coinbase.com/x402/welcome). No
signup, no API key.

```bash
npx -y @houdiniswap/mcp-server
```

## A funded wallet is required

Every tool costs money. `GET /status` is the only free endpoint and it is not exposed as a tool, so
without a funded wallet **every call returns 402**. Fund an EVM wallet with a couple of dollars of
**USDC on Base** — no ETH needed, payments are gasless EIP-3009 authorisations settled by the
facilitator.

> Use a wallet funded with only what you intend to spend. The private key is stored on the machine
> running the server and signs payments automatically.

## Claude Code

```
/plugin marketplace add HoudiniSwap/houdiniswap-agent
/plugin install houdiniswap@houdiniswap
```

That installs the swap skill *and* wires up this server. Or, MCP server only:

```bash
claude mcp add houdiniswap --env HOUDINI_X402_PRIVATE_KEY=0x... -- npx -y @houdiniswap/mcp-server
```

## Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "houdiniswap": {
      "command": "npx",
      "args": ["-y", "@houdiniswap/mcp-server"],
      "env": { "HOUDINI_X402_PRIVATE_KEY": "0xYOUR_WALLET_PRIVATE_KEY" }
    }
  }
}
```

The `-y` matters: without it npx prompts on stdin, which for a stdio MCP server is the JSON-RPC
channel, and the server never starts.

## Tools

`getTokens` · `getChains` · `getSwapProviders` · `getMinMax` · `getQuote` · `createExchange` ·
`getOrder` · `getOrders` · `dexApprove` · `dexCheckAllowance` · `dexConfirmTx` ·
`dexChainSignatures` · `dexSignRequest` · `cexDepositRequest` · `dexSignStatus` · `swap`

`dexSignRequest` serves a page on `127.0.0.1` and hands the swap to the user's own browser wallet,
so no private key is ever pasted into anything. EVM only. It signs the swap, not the approval,
which happens before an order exists. `cexDepositRequest` serves the same page for a CEX order's
deposit, with network, address and amount prefilled, so the address is never copied by hand onto
the wrong chain. Both are disabled when the HTTP transport is bound off-loopback, since a page on
the server's host is no use to a remote caller.

Reads cost $0.0001, quotes $0.001, `createExchange` and `dexConfirmTx` $0.01 each. A standard swap
runs about $0.012; a DEX swap about $0.022, because it pays the exchange tier twice.

Responses are shaped for agents: descriptions, icons and URL templates are stripped, and `getQuote`
keeps the best few per type while reporting how many it omitted. Pass `verbose: true` to any tool
for the raw response — pair it with a small `pageSize`, since a full raw page can exceed a client's
tool-result limit.

## Environment

| Variable | Description |
|---|---|
| `HOUDINI_X402_PRIVATE_KEY` | EVM key for x402 payments. Accepted with or without the `0x` prefix. |
| `HOUDINI_API_KEY` | Partner API key (`id:secret`), if you have one. Takes precedence. |
| `HOUDINI_PARTNER_ID` | Public partner ID. |
| `HOUDINI_API_URL` | API base URL. Defaults to the production partner API. |
| `PORT` / `HOUDINI_HTTP_HOST` | HTTP transport only. Binds `127.0.0.1:8080` by default. |

None is strictly required — the server starts without any of them, but every tool then returns 402.

## Notes

- **Paid calls are spaced ~5 seconds apart.** The facilitator settles each payment on-chain and two
  at once from the same wallet fail, so the client serialises them. A full swap takes 20-30s; that
  is expected, not a hang. Individual payments time out after 60s.
- **A payment ceiling is enforced client-side.** The signer only accepts USDC on Base up to $0.10
  per call, so a misconfigured or hostile endpoint cannot drain the wallet.
- **HTTP mode binds loopback only** and has no authentication. Put an authenticating proxy in front
  of it before exposing it.

MIT · [Source](https://github.com/HoudiniSwap/houdiniswap-agent)
