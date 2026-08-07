# Local browser signing for DEX swaps

## Problem

DEX swaps return unsigned transaction data that the user must sign themselves. The
x402 key cannot be used — it exists only to pay for API calls, and the skill
forbids using it for DEX transactions.

Today the documented path is a Node script that asks the user to paste their
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

Two tools rather than one blocking call — a browser signature can take minutes,
and an MCP tool that blocks that long is indistinguishable from a hang.

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

## Security

The listener holds no funds and no key, but it does decide what a user is asked
to sign, so it is treated as security-relevant.

| Concern | Mitigation |
|---|---|
| Reachable off-box | Binds `127.0.0.1` only, on an ephemeral port. Never `0.0.0.0`. |
| Another local process asks the user to sign something | The token is 32 random bytes from `crypto.randomBytes`, single use, and bound to one order. Without it the route 404s. |
| Attacker supplies their own calldata | The page never accepts a transaction from the URL or the request body. The server holds it in memory, taken from the order the agent created. |
| Token reuse / replay | Consumed on first successful POST. A second POST 409s. |
| Stale requests accumulating | Each expires with its quote, and a sweep removes expired entries. The listener shuts down when none remain. |
| Page loading remote code | Everything is inline. CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'`. No CDN, no fonts, no analytics. |
| Cross-site requests to the listener | POST requires `Content-Type: application/json` and a same-origin `Origin` header; anything else is rejected. Browsers will not send a JSON content-type cross-origin without a preflight, which is not answered. |
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

## Migration

The signing script stays for testing, but stops being the documented path. The
skill's DEX workflow points at `dexSignRequest` instead, and the "paste the raw
tx data into `cast send`" line goes away.
