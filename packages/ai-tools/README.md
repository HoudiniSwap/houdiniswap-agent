# @houdiniswap/ai-tools

[Vercel AI SDK](https://sdk.vercel.ai) tool definitions for
[HoudiniSwap](https://houdiniswap.com) — crypto swap aggregation across 14 CEXes and 20+ DEXes, paid
per call in USDC on Base via [x402](https://docs.cdp.coinbase.com/x402/welcome).

```bash
npm install @houdiniswap/ai-tools
```

```ts
import { createHoudiniTools } from "@houdiniswap/ai-tools";
import { generateText, stepCountIs } from "ai";

const tools = createHoudiniTools({
    auth: { type: "x402", privateKey: process.env.WALLET_KEY as `0x${string}` },
});

const { text } = await generateText({
    model: "anthropic/claude-sonnet-5",
    tools,
    prompt: "Swap 0.1 BTC to ETH and send it to 0x…",
    stopWhen: stepCountIs(10),
});
```

## A funded wallet is required

Every tool costs money — there is no free tier. Fund an EVM wallet with a couple of dollars of
**USDC on Base**. No ETH needed; payments are gasless EIP-3009 authorisations. Use a wallet holding
only what you intend to spend.

## Tools

`getTokens` · `getChains` · `getSwapProviders` · `getMinMax` · `getQuote` · `createExchange` ·
`getOrder` · `getOrders` · `dexApprove` · `dexCheckAllowance` · `dexConfirmTx` ·
`dexChainSignatures` · `swap`

Reads cost $0.0001, quotes $0.001, `createExchange` and `dexConfirmTx` $0.01 each.

Unlike [`@houdiniswap/mcp-server`](https://www.npmjs.com/package/@houdiniswap/mcp-server), these
tools return the **raw API response** with no shaping. A single unfiltered `getQuote` can return
150+ quotes, so consider trimming results before they reach the model's context.

### No browser signing here — deliberately

`mcp-server` has `dexSignRequest`/`dexSignStatus`, which open a page on `127.0.0.1` for the user to
sign a swap in their own wallet. They are **not** ported here, and should not be.

That design is safe only because an MCP server runs on the same machine as the person using it:
loopback is what makes the page unreachable by anyone else. These tools usually run on a server,
where the operator and the end user are different people — a signer bound there would be reachable
by whoever controls the host and by nobody the transaction actually belongs to.

If you need users to sign, hand the transaction to your own frontend and let their wallet sign it
there. The unsigned transaction is on the order's `metadata`.

## Auth

```ts
createHoudiniTools({ auth: { type: "x402", privateKey: "0x…" } })   // pay per call
createHoudiniTools({ auth: { type: "apiKey", key: "id:secret" } })  // partner key
```

Paid calls are serialised ~5s apart — the facilitator settles each payment on-chain and two at once
from the same wallet fail. A payment ceiling of $0.10 per call is enforced client-side.

MIT · [Source](https://github.com/HoudiniSwap/houdiniswap-agent)
