# @houdiniswap/agent-shared

Shared HTTP and [x402](https://docs.cdp.coinbase.com/x402/welcome) payment client for the
[HoudiniSwap](https://houdini.com) agent packages.

**You probably do not want to install this directly.** It is a runtime dependency of
[`@houdiniswap/mcp-server`](https://www.npmjs.com/package/@houdiniswap/mcp-server) and
[`@houdiniswap/ai-tools`](https://www.npmjs.com/package/@houdiniswap/ai-tools), and is installed
automatically with either.

## What it provides

- `HoudiniClient` — the only thing that talks to the HoudiniSwap partner API. Handles auth headers,
  query serialisation, typed errors, and a 30s request timeout.
- `createX402Fetch` — a `fetch` wrapper that answers HTTP 402 by signing a USDC payment and
  retrying: an EIP-3009 authorisation on Base for an EVM key, a USDC transfer on Solana for a Solana
  key (`createX402Fetch({ evm, svm })`).

## Payment safety

Payment terms arrive from the server in the 402 challenge, so the client bounds what it will sign:
**USDC on Base or Solana only (for the keys given), up to $0.10 per call** by default. A server
asking for more — or for a different asset or chain — is refused rather than signed.

```ts
createX402Fetch(key, { maxPaymentAtomic: 10_000n })  // tighten to $0.01
```

Payments are serialised with a ~5s floor between them: the facilitator settles each on-chain, and
two settlements at once from the same wallet fail. Each payment is bounded at 60s.

MIT · [Source](https://github.com/HoudiniSwap/houdiniswap-agent)
