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
**USDC on Base or Solana only (for the keys given), paid to HoudiniSwap's addresses
(`DEFAULT_X402_PAY_TO`), up to $0.10 per call and $10 per client** by default. A server asking for
more — or for a different asset, chain or recipient — is refused rather than signed. Every signed
payment counts toward the $10, including one refused on the first network before the other is
tried: with an empty Base wallet and a funded Solana one, each call signs twice. The budget lasts
as long as the client (or `createX402Fetch` result); a long-running server that keeps one needs a
new client, or a higher `budgetAtomic`, once it is spent.

**Changed in 0.1.12:** the recipient pin and the $10 budget are new. A client pointed at another
HoudiniSwap environment (`baseUrl`) is now refused there until its addresses are passed as `payTo`.

```ts
createX402Fetch(key, { maxPaymentAtomic: 10_000n })  // tighten to $0.01
createX402Fetch(key, { budgetAtomic: 50_000_000n })  // allow $50 in total
createX402Fetch(key, { payTo: { base: ["0x…"] } })   // another HoudiniSwap environment
```

Payments are serialised with a ~5s floor between them: the facilitator settles each on-chain, and
two settlements at once from the same wallet fail. Each payment is bounded at 60s.

MIT · [Source](https://github.com/HoudiniSwap/houdiniswap-agent)
