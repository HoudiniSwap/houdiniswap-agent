# Local browser signing for DEX swaps and CEX deposits

> Shipped in `@houdiniswap/mcp-server` 0.1.11 and hardened since. This describes
> what the code does; where it once read as a proposal, it now reads as a record.

## Problem

DEX swaps return unsigned transaction data that the user must sign themselves. The
x402 key cannot be used — it exists only to pay for API calls, and the skill
forbids using it for DEX transactions.

The path this replaced was a Node script that asked the user to paste their
private key. That works, but it is the wrong thing to teach: pasting a private
key into a program is the exact habit phishing depends on. It is also awkward —
it needs a real terminal, because a piped stdin cannot prompt with echo off.

MetaMask cannot help directly: its send flow has no reliable way to submit
arbitrary calldata, which is why the approval step in testing had to go through
Basescan's contract-write UI and the swap step through a script.

## Approach

The MCP server serves a single-page signer on loopback. The user opens a URL in
the browser where their wallet extension already lives, the page hands the
transaction to `window.ethereum`, and the wallet shows its own confirmation UI.

**The private key never leaves the wallet.** The user reviews the transaction in
the interface they already trust, rather than in ours.

```
  agent                     mcp server                 browser + wallet
    │                            │                            │
    │  createExchange            │                            │
    │───────────────────────────►│                            │
    │  ◄── order + metadata      │                            │
    │                            │                            │
    │  dexSignRequest(houdiniId) │                            │
    │───────────────────────────►│ start loopback listener    │
    │                            │ mint one-time token        │
    │  ◄── http://127.0.0.1:PORT/sign/TOKEN                   │
    │                            │                            │
    │  "open this link"          │                            │
    │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─►│
    │                            │  GET /sign/TOKEN           │
    │                            │◄───────────────────────────│
    │                            │  page + tx (server-side)   │
    │                            │───────────────────────────►│
    │                            │                            │ wallet confirms
    │                            │  POST /sign/TOKEN {txHash} │
    │                            │◄───────────────────────────│
    │  dexSignStatus(token)      │                            │
    │───────────────────────────►│                            │
    │  ◄── { status, txHash }    │                            │
```

## Tools

Request and status are separate tools rather than one blocking call — a browser
signature can take minutes, and an MCP tool that blocks that long is
indistinguishable from a hang. Both request tools share one status tool and one
listener.

### `dexSignRequest({ houdiniId })`

Starts the listener if it is not already running, mints a token bound to that
order, and returns:

```json
{ "url": "http://127.0.0.1:53421/sign/9f3c…", "token": "9f3c…",
  "expiresAt": "2026-08-07T06:28:10.147Z", "chainId": 8453 }
```

Costs one status call ($0.0001): it re-reads the order from `GET /orders/:id` rather than
trusting one the agent is holding, so the transaction presented for signature is the one
the API currently has on file.

### `dexSignStatus({ token })`

```json
{ "status": "pending" | "signed" | "rejected" | "expired",
  "txHash": "0x…", "error": "user rejected the request" }
```

Free — answered from the signer's own memory, with no API call. The agent polls this,
then calls `dexConfirmTx` with the hash as
usual — confirmation stays an explicit agent action rather than something the
signing server does behind its back.

After a **deposit** the `next` field points at `getOrder` instead: a CEX watches its own
deposit address and credits the order itself, and `dexConfirmTx` on a CEX order would pay
the $0.01 exchange tier for a call that does not apply.

### `cexDepositRequest({ houdiniId })`

The same page, for the other half of the problem. A CEX order is funded by sending money
to a deposit address, and the agent's only previous move was to print that address and
hope. Deposit addresses on EVM chains are ordinary addresses, so a wallet will send one on
Ethereum as readily as on Base — and that loss is unrecoverable. Prefilling the network,
address and amount removes the choice rather than warning about it.

Returns the same envelope as `dexSignRequest`. Native coins go as a plain transfer, tokens
as an ERC-20 `transfer(address,uint256)`.

**It refuses rather than guesses**, because every failure here is an irreversible transfer:

| Case | Why not |
|------|---------|
| Order is a DEX order | Its `depositAddress` is only an echo of the sender; use `dexSignRequest` |
| Order is past `WAITING` | The exchange has already seen a deposit; a second page invites a second send |
| Non-EVM chain or address | The page signs through `window.ethereum` and cannot reach that chain |
| Token decimals unknown | Defaulting to 18 sends the wrong amount by orders of magnitude |
| Amount does not fit the decimals | A silently rounded deposit is one the exchange may re-rate |

Amounts are scaled on the decimal string, never through a float: `0.006 * 1e18` is
`6000000000000000.1` as a double, and `28.1 * 1e6` is `28099999.999999996`. See
`src/units.ts`.

This does **not** make the agent able to move funds. The wallet still signs, and the user
still confirms — the same trust boundary as `dexSignRequest`. An agent with no human at a
browser cannot use it, which is the point.

## Security

The listener holds no funds and no key, but it does decide what a user is asked
to sign, so it is treated as security-relevant.

| Concern | Mitigation |
|---|---|
| Reachable off-box | Binds `127.0.0.1` only, on an ephemeral port. Never `0.0.0.0`. |
| Another local process asks the user to sign something | The token is 32 random bytes from `crypto.randomBytes`, single use, and bound to one order. Without it the route 404s. |
| Attacker supplies their own calldata | The page never accepts a transaction from the URL or the request body. The server holds it in memory, taken from the order the agent created. |
| Token reuse / replay | Consumed on first successful POST. A second POST 409s. |
| Stale requests accumulating | Each expires with the order, and a sweep removes entries five minutes past that. The grace matters: a user still in their wallet when the quote lapses has a transaction on chain, and the hash has to remain recordable — the page stops being served at expiry, but a POST is still accepted. The listener shuts down when none remain. |
| Page loading remote code | Everything is inline. CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; form-action 'none'; frame-ancestors 'none'`. No CDN, no fonts, no analytics. |
| Cross-site requests to the listener | POST requires `Content-Type: application/json` and an `Origin` matching the port the request arrived on. The header is *required*, not merely checked when present — a raw socket omitting it used to be accepted. Browsers will not send a JSON content-type cross-origin without a preflight, which is not answered. |
| Two submissions racing | The status is re-checked inside the body-end handler, where nothing awaits before the assignment. Checking only when the headers arrived meant several POSTs with delayed bodies were all accepted and the last hash won. |
| A malformed field taking the server down | Rendering happens before the status line is written, and the whole handler is wrapped: a throw returns 500 instead of an uncaughtException that would kill every tool and lose the pending map. `value` is validated when the request is created. |
| Untrusted text reaching the model | A wallet message or contract revert string is capped in the page, capped again at 300 characters, and handed to the agent quoted and labelled as untrusted rather than bare. |
| Wallet on the wrong network | The page checks `chainId` and asks the wallet to switch before offering to sign. |
| User cannot verify what they are signing | The page shows amount in, amount out and recipient — taken from the order, since decoding calldata would need each router's ABI — plus the network, the contract being called and the native value, above the sign button. The wallet shows its own review on top of that. |

The server exits with the MCP process. It is not a daemon and does not persist
anything to disk.

## What this does not do

- **No mobile.** A phone cannot reach a loopback port on a laptop. WalletConnect
  is the answer there, and is a larger piece of work — session pairing, its own
  dependency. This design does not preclude it; a second signer can register
  alongside.
- **No hardware wallet directly.** Ledger and Trezor work through the browser
  extension, so they are covered transitively, but there is no direct transport.
- **No headless use.** An agent running without a human at a browser cannot use
  this. That case still needs a key, and should stay explicitly opt-in.

## What the page does before the wallet opens

- Checks the connected account matches the order's `from`, and refuses otherwise.
- Asks the wallet to switch network if it is not on the order's chain.
- Converts `value` from the decimal string the API returns into the hex quantity
  `eth_sendTransaction` expects. `"0"` is identical in both, so this was invisible
  until the first swap that actually sent native value.
- Estimates gas itself and passes an explicit limit. Left to fill it in, a wallet
  whose own estimate does not arrive substitutes a block-sized default —
  140,000,000 against Base's 25,000,000 cap — and the RPC rejects the send after
  the user has already approved it.

## Migration

Done. The skill's DEX workflow points at `dexSignRequest`, and the "paste the raw
tx data into `cast send`" line is gone. The signing script remains only for
testing.
