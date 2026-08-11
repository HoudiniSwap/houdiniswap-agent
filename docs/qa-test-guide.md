# QA test guide

Install the plugin, then work through every feature — token discovery, quotes, all
three swap types, and browser-based transaction signing. Written to be followed
literally.

| | |
|---|---|
| `@houdiniswap/mcp-server` | 0.1.15 |
| plugin | 0.1.11 |
| tools | 16 |
| network | Base (`eip155:8453`) |

Costs, minimums and status codes below were measured against the live API, not
copied from other documentation. If the backend changes provider minimums, the
figures in T4 drift.

Every case here has now been run end to end against mainnet with real funds,
including the CEX, private and Permit2 paths. Where a case has a **Known good**
line, that is a measured result, not an expectation.

> **Open backend issue — do not be surprised by it.** Under x402 every payer is
> authenticated as the same partner, so `getOrders` and `getOrder` return **other
> people's orders**, private ones included. Reported separately; it is a backend
> scoping fix, not something this package can correct. Do not file it again, and do
> not treat a stranger's order in your list as a client bug.

---

## Quick install

**1. Fund a wallet.** Put **$5–10 of USDC on Base** in a throwaway wallet. Every API
call is paid per request — without a funded wallet, every tool returns 402. Add ~$2
of ETH only if you will test DEX swaps, since you broadcast those yourself.

**2. Install.**

```
/plugin marketplace add HoudiniSwap/houdiniswap-agent
/plugin install houdiniswap@houdiniswap
```

Claude Code prompts for the wallet private key. Paste it with or without the `0x` —
both work. For Claude Desktop or Cursor, see [Other clients](#other-clients).

**3. Fully quit and reopen.** Not `/reload-plugins` — that leaves the old server
running with old code. This is the single most common source of "it's broken"; see
[the trap below](#the-trap-that-will-waste-your-afternoon).

**4. Check it works.** Ask: *"find USDC on Base"*. You should get the token with its
contract address and price. A 402 means the wallet is not funded, or the USDC is not
on Base.

Then talk to it — *"swap 20 USDC on Base to SOL"* — and it walks you through quotes,
the order, and the deposit address.

---

## Before you start

### A funded wallet

Every API call is paid per request in USDC on Base — there is no free tier and no
signup. Only `GET /status` is free, and it is not exposed as a tool, so **without a
funded wallet every single tool returns 402**.

- Fund a **throwaway** wallet with USDC on Base. Not a wallet you keep anything in.
- **$5–10 of USDC** covers a full test pass with room to spare.
- Payments are gasless (EIP-3009 authorizations settled by a facilitator), so no ETH
  is needed *for API calls*.
- ETH *is* needed to test DEX swaps, since you broadcast those yourself. About **$2**
  of ETH on Base is plenty — a swap costs well under a cent in gas.

> **The key is stored in plaintext.** On Linux the plugin writes your key to
> `~/.claude/.credentials.json` (mode 0600), not an OS keychain. Anything running as
> your user can read it. Use a wallet holding only what you intend to spend.

### A browser with a wallet extension

DEX signing opens a page on `127.0.0.1` and hands the transaction to MetaMask, Rabby
or similar. Verified on Chrome and Firefox. You need the same wallet that funds the
swap — which can be the same throwaway wallet.

### What a full pass costs

| Operation | Price | Tools |
|---|---|---|
| Read | $0.0001 | `getTokens`, `getChains`, `getSwapProviders`, `getMinMax`, `dexApprove`, `dexCheckAllowance`, `dexChainSignatures` |
| Quote | $0.001 | `getQuote` |
| Exchange | $0.01 | `createExchange`, `dexConfirmTx` |
| Status | $0.0001 | `getOrder`, `getOrders`, `dexSignRequest` |
| Local only | free | `dexSignStatus` |

A complete CEX swap runs about **$0.012**; a DEX swap with approval about **$0.022**.
The whole test plan is well under a dollar in API fees — the real cost is the swap
amounts themselves.

---

## Other clients

The plugin route is in [Quick install](#quick-install) above — it brings the
swap-agent skill *and* the MCP server. The routes below are for everything else.

### Claude Code — MCP server only

No skill, just the 15 tools. Use this to test tool behaviour without the skill's
guidance shaping it.

```bash
claude mcp add houdiniswap \
  --env HOUDINI_X402_PRIVATE_KEY=0x... \
  -- npx -y @houdiniswap/mcp-server
```

### Claude Desktop / Cursor

Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`.
Cursor: `.cursor/mcp.json`. Same shape for both.

```json
{
  "mcpServers": {
    "houdiniswap": {
      "command": "npx",
      "args": ["-y", "@houdiniswap/mcp-server"],
      "env": { "HOUDINI_X402_PRIVATE_KEY": "0xYOUR_KEY" }
    }
  }
}
```

The key is accepted with or without the `0x` prefix — MetaMask exports it without,
and both work.

---

## The trap that will waste your afternoon

**Read this before filing any bug about a fix that "didn't work".**

> **Reloading plugins is not restarting them.**
>
> After any version change, fully quit and reopen your client. `/reload-plugins`
> reconnects but leaves the old MCP server process alive with the old code in memory
> — Node loads JavaScript at startup, so overwriting files on disk does nothing to a
> running process. Separately, `npx` can serve a stale cached version.
>
> This produced hours of chasing a bug that had already been fixed. If behaviour does
> not match the release notes, *verify which version is actually running before you
> investigate anything else.*

To force a genuinely clean state:

```bash
# 1. clear the npx cache for the unpinned spec
rm -rf ~/.npm/_npx/*/node_modules/@houdiniswap/mcp-server

# 2. fully quit the client — not a reload — then reopen

# 3. confirm what is running
ls -l ~/.npm/_npx/*/node_modules/@houdiniswap/mcp-server/package.json
```

---

## Test plan

Fifteen cases in dependency order. Each shows what to run, what should happen, and
what a failure looks like.

Cost markers: **[free]** local only · **[paid]** API fees only · **[funds]** moves
real crypto.

### Discovery and quoting

#### T1 — All 15 tools register **[free]**

Ask the assistant to list its HoudiniSwap tools, or inspect the MCP tool list.

- **Expect:** 15 tools — `getTokens`, `getChains`, `getQuote`, `createExchange`,
  `getOrder`, `getOrders`, `getSwapProviders`, `getMinMax`, `dexApprove`,
  `dexCheckAllowance`, `dexConfirmTx`, `dexChainSignatures`, `dexSignRequest`,
  `dexSignStatus`, `swap`.
- **Fails if:** fewer than 15 — almost always a stale server. Re-read the section
  above before filing.

#### T2 — Unfunded wallet fails clearly **[free]**

Configure a wallet with no USDC and call any tool.

- **Expect:** a 402 whose message names the cause — no key configured, or payment
  refused, check the wallet holds USDC *on Base*.
- **Fails if:** the message is `HTTP 402: Unknown error`, or anything that does not
  say what to fix.

#### T3 — Token search returns usable IDs **[paid]**

"Find USDC on Base." Then try an ambiguous one: "find ETH".

- **Expect:** each result shows name, symbol, chain, contract address (absent for
  native tokens), price, and mainnet/verified flags. Multiple matches are *listed for
  you to choose*, never silently picked.
- **Also check:** search a scam-looking token. Anything with `unverified: true` must
  produce an explicit warning before any swap proceeds.
- **Fails if:** it picks a token for you when several match, or omits the contract
  address.

#### T4 — Minimums are checked before quoting **[paid]**

Ask for a swap well below the minimum — for example $2 of USDC to SOL via CEX.

- **Expect:** it reports the minimum rather than producing a doomed order. The API
  answers a below-minimum quote with `AMOUNT_TOO_LOW 422` naming the figure, so this
  should never reach `createExchange`.
- Measured minimums from USDC on Base:

  | Route | Minimum |
  |---|---|
  | DEX | 5.00 |
  | CEX → SOL | 10.50 |
  | CEX → USDT (Tron) | ~17 |
  | CEX → ETH | 20.01 |
  | CEX → XRP | ~30 |
  | **Private (any destination)** | **26.26** |

- **Fails if:** it creates an order anyway, spending $0.01 on something that cannot
  execute.

#### T5 — Quotes come back as a numbered menu **[paid]**

Request quotes for a valid pair and amount. Then ask to "sort by fastest" and "only
use ChangeNow".

- **Expect:** a numbered list with provider, output amount, USD value, ETA and fee.
  Sorting and provider filters re-query and visibly change the result.
- **Also check:** price impact above 2% is flagged. Quotes expire in about **60
  seconds** — a stale one should be re-quoted, not used.
- **Fails if:** a provider filter is ignored, or a quote is shown from a provider you
  excluded.

### Swaps that move money

> Use small amounts and a throwaway wallet. These cases broadcast real transactions
> on Base and send real funds to exchange deposit addresses. Nothing here is
> reversible. Stay at the minimum.

#### T6 — CEX swap, order creation **[paid]**

Create a standard swap, e.g. USDC (Base) → SOL, at or just above the minimum.

- **Expect:** an order with a **houdiniId**, a **deposit address**, and the exact
  amount to send — all shown clearly. No signing is involved in a CEX swap.
- **Fails if:** the deposit address is missing or buried, or the amount shown differs
  from the quote.

#### T7 — CEX swap, funding and settlement **[funds]**

Send the stated amount to the deposit address, then track the order.

- **Expect:** status progresses `WAITING` → `CONFIRMING` → `EXCHANGING` → `SENDING` →
  **`FINISHED` (4)**, and the output lands at your destination address.
- **Watch for:** status **5 is EXPIRED, not success**, and **6 is FAILED**. A swap
  reported as successful on either is a serious bug — file it immediately.
- **Known good:** completed twice. 0.006 ETH Base → Arbitrum settled in ~4.5 min,
  and 0.006 ETH → USDC on Base in ~2 min. Both paid out within a hair of the quote,
  and `outAmount` reconciled to the on-chain credit.

#### T8 — Private (anonymous 2-hop) swap **[funds]**

Request a private swap. The minimum is much higher than CEX and is set by the
**input** leg, not the destination: **26.26 from USDC on Base**, the same figure
whether you send to ETH or SOL.

- **Take the minimum from `getMinMax().private.min`.** The `min` on an individual
  quote is the provider's leg minimum and understates it roughly threefold — quotes
  advertising `min` of 9.11–14.99 were all rejected at 10 with `AMOUNT_TOO_LOW`.
- **Expect:** same deposit-address flow as CEX. Private quotes carry **no provider
  name** — deliberate, not a bug, since naming the hops would defeat the privacy.
  The finished order carries none either.
- **Also check:** it passes through status **3 `ANONYMIZING` /
  `SECOND_EXCHANGE_IN_PROGRESS`** between the hops, with the first leg FINISHED
  while the second is EXCHANGING. That is progress, not a stall.
- **Fails if:** a missing `swap` field on a private quote is treated as an error, or
  the intermediate hop is described as "randomised" (it is a best-of selection).
- **Known good:** 26.5 USDC → 0.013835820 ETH on Base, settled in **~2 minutes**
  against a 13-minute ETA, `outAmount` matching the chain exactly.

### DEX swaps and browser signing

The newest surface and the one most worth hammering. A DEX swap is signed by *you*,
in your own wallet — the server's payment key must never touch it.

> **Read this before filing a DEX revert.** The order says it expires in 30 minutes,
> but the transaction inside it goes stale in **one to two minutes**. Identical
> calldata replayed with `eth_call` succeeded at the order's creation block and
> reverted 79 blocks (~2.5 min) later, against a pool holding 20,000 USDC and 10
> WETH — price movement, not liquidity.
>
> It is provider-specific. A SushiSwap route encoded an outer bound of quote × 0.995
> **despite `slippage: 1` being requested**, and an inner bound equal to the quote
> exactly — zero headroom. A Uniswap route for the same pair embedded an explicit
> deadline, honoured the requested slippage, and survived. **Use Uniswap for the
> signing-flow cases (T10–T13)**, or SushiSwap will hand you spurious failures.
>
> Sign promptly, and re-quote from scratch if you dawdle — a fresh `dexSignRequest`
> on the same order serves the same stale calldata. Nothing is lost when this
> happens: the page estimates gas first, so no funds move.

#### T9 — Allowance check and approval **[funds]**

Quote a DEX swap spending an ERC-20 (e.g. USDC → ETH on Base) from a wallet with no
allowance set.

- **Expect:** the allowance check reports insufficient, and an approval step is
  produced. Approvals are **not** covered by `dexSignRequest` — no order exists yet at
  that point — so you will be handed the approval transaction to submit yourself.
- **Check:** the approval is capped at the swap amount, not unlimited. Verified:
  SushiSwap returned `approve(router, 0x53ec60)` = exactly 5.5 USDC, and the
  allowance went 0 → 5.5 → **0**, fully consumed with no residual.
- **Note:** `requiresApproval` on the quote and `dexCheckAllowance` mean different
  things. The first is a static provider capability and stays `true` even when you
  already hold an allowance; the second is the live check. Approve on the second,
  or you will send a redundant approval before every swap.

#### T9b — Permit2 signature path **[funds]**

Pick a provider whose quote shows `supportsSignatures: true` — PancakeSwap and
Uniswap do, SushiSwap does not — and call `dexApprove` with `usePermit: true`.

- **Expect:** `signatures[]` populated with EIP-712 `PermitSingle` typed data for
  **Permit2** (`0x31c2F6…c768`), plus a one-time on-chain `approve` to Permit2 in
  `approvals[]`. Sign the typed data and pass it to `createExchange` as
  `signatures: [{ key, signature, swapRequiredMetadata }]`.
- **Check:** the permit `amount` is capped at the swap amount, and afterwards the
  Permit2 **nonce has incremented by exactly 1** — the signature is single-use.
  Both the Permit2 allowance and the ERC-20 allowance to Permit2 should read 0.
- **Once the on-chain approve exists,** a second `dexApprove` returns
  `approvals: []`. That is correct, not a failure.
- **Fails if:** the permit is written for an unlimited amount, the nonce does not
  move, or an allowance is left behind.

#### T10 — Signing page opens and reads correctly **[paid]**

Create a DEX order, then ask to sign it. You get a
`http://127.0.0.1:PORT/sign/<token>` URL.

- **Expect:** the page shows network, **you send**, **you receive (est.)**, recipient,
  the contract being called, native value, and a calldata fingerprint — with real
  tickers, not database IDs.
- **Fails if:** amounts show as 24-character hex IDs instead of `USDC`/`ETH`, or any
  figure disagrees with the quote.

#### T11 — Wallet confirmation is sane **[funds]**

Click through to your wallet, but read the confirmation carefully *before* approving.

- **Expect:** a real network fee (a fraction of a cent on Base) and no "likely to
  fail" warning. The amount must match the page.
- **Fails if:** the fee shows as **Unavailable**, or the wallet warns the transaction
  will fail — that pattern previously meant no gas limit was being sent. **Cancel and
  file it.**
- **Critical:** for a swap sending native ETH, confirm the wallet shows the amount you
  expect — e.g. **0.003 ETH, not 3.4 ETH**. A units bug here is the difference between
  a swap and a catastrophe.

#### T12 — Signature reaches the agent **[funds]**

Approve in the wallet and watch the page and the assistant.

- **Expect:** the page reports sent with the hash; the assistant picks it up, confirms
  the transaction, and the order reaches **`FINISHED` (4)**.
- **Fails if:** the page says "Sent." but the assistant polls `pending` forever — that
  means the result never got back, and it is exactly the failure mode this release
  fixed. Capture both sides.

#### T13 — Rejection is reported honestly **[paid]**

Open a signing page and press **Cancel** in the wallet instead of approving.

- **Expect:** status `rejected`, and the assistant tells you *you declined* and that
  nothing was sent.
- **Also:** `rejected` covers two different things — you declining, and the swap being
  unable to execute on-chain. The assistant should distinguish them and must never
  call `dexConfirmTx` after either.

#### T14 — Signing links are not reusable **[free]**

Security checks on the local signing server. Requires no wallet.

All eleven of these pass today; re-run them after any change to the signer.

| Check | Expected |
|---|---|
| Token with one character changed | 404 |
| Empty token (`/sign/`) | 404 |
| Path traversal (`/sign/../../etc/passwd`) | 404 |
| Any unrelated path (`/`) | 404 |
| Request from another machine on the LAN | **connection refused** — loopback only |
| POST with no `Origin` header | 403 |
| POST with `Origin: https://evil.example` | 403 |
| POST body of 3 MB | 413 |
| Reload after signing | already resolved; cannot be signed twice |
| Link left past the order's expiry | see below |
| `dexSignStatus` on a long-dead token | `expired`, with "get a fresh link" |

**On the expiry case:** you get a *connection refused*, not a 404, because the
server shuts its listener down entirely once nothing is pending. That is stronger
than a 404, not a regression. Confirm with `ss -ltn | grep <port>` — nothing should
be bound.

**Fails if** any of these succeeds. The token is the only access control the signer
has.

#### T15 — The one-step `swap` tool **[funds]**

Use the composite `swap` tool for a simple CEX swap.

- **Expect:** token lookup, amount validation, best quote and order creation in a
  single call, returning a deposit address, the provider, and the order's `expires`.
- **Known limitation:** it deliberately skips the route menu, the unverified-token
  warning and the price-impact check, and may pick a *private* route. Documented
  behaviour — worth confirming, not filing.
- **Known good:** 0.006 ETH → USDC on Base via ChangeNow, FINISHED in ~2 min.

#### T16 — Cross-chain DEX **[funds]**

Quote a DEX swap between two chains — e.g. ETH on Arbitrum → ETH on Base. Bungee,
Uniswap and Near Intents all return cross-chain routes, and they beat the CEX rate
for the same pair.

- **Critical:** the transaction's `value` is **larger than the order's `inAmount`** —
  the bridge fee rides on top. A 0.0059 ETH order carried `value` of 0.005929… ETH,
  a flat ~0.0000292 ETH more.
- **Check:** budget gas *on top of `value`*. That same order needed **480,000 gas**
  and left only 140,000 affordable, so a wallet funded to `inAmount` cannot send it.
  The signing page now refuses this before opening the wallet, naming the shortfall.
- **Fails if:** the agent sizes the transaction from `inAmount`, or the page opens a
  wallet for a transaction the balance cannot cover.
- **Known good:** 0.00585 ETH Arbitrum → Base landed **exactly** 0.005843 ETH in ~90s.

#### T17 — Rate limiting **[free]**

The limit is 60 requests/minute, but the IP-keyed counter increments **before**
payment, so unpaid 402s count too.

- Fire unauthenticated `GET /v2/chains` in a loop. A 429 arrives after ~60–67
  requests, with `code`, `message`, `requestId` and `retryAfter` in the body.
- **Because x402 is request → 402 → retry-with-payment, each completed paid call
  costs the IP counter two.** Budget **~30 completed calls per minute per IP**.
- **Note for a test team:** the bucket is per-IP, so testers behind one office NAT
  share it no matter whose wallet pays — and it can be exhausted by traffic that
  never pays at all.

#### T18 — No stale servers **[free]**

Before testing any version change, check nothing old is still running:

```bash
pgrep -af houdiniswap-mcp        # expect one server, not seven
pkill -f houdiniswap-mcp         # then fully restart the client
```

Instances accumulate — seven were found alive at once, the oldest up 25 hours,
because each `npm exec` parent outlives its client session and nothing reaps it.
Every one of them holds your wallet key in `/proc/<pid>/environ`. This is the real
mechanism behind [the restart trap](#the-trap-that-will-waste-your-afternoon).

---

## Reference

### Order status codes

The two that matter most: **4 is success** and **5 is expiry**. Prefer the
`displayStatus` field over the raw number.

| Code | Name | Meaning |
|---|---|---|
| -2 | `INITIALIZING` | Being set up |
| -1 | `NEW` | Created, not yet awaiting deposit |
| 0 | `WAITING` | Awaiting your deposit |
| 1 | `CONFIRMING` | Deposit seen, confirming on-chain |
| 2 | `EXCHANGING` | Swap in progress at the provider |
| 3 | `ANONYMIZING` | Private swaps only — second hop |
| **4** | **`FINISHED`** | **Success** |
| **5** | **`EXPIRED`** | **No deposit arrived in time — not success** |
| **6** | **`FAILED`** | **Failed at the provider** |
| 7 | `REFUNDED` | Funds returned |
| 8 | `DELETED` | Removed |

### Rate limit

Nominally 60 requests per minute, but counted twice over: an IP-keyed counter
increments *before* payment and a payer-keyed one *after* settlement. Because x402 is
request → 402 → retry-with-payment, each logical call costs the IP counter two.
**Budget about 30 completed calls per minute per IP** — and note that two testers
behind one NAT share the bucket no matter whose wallet pays.

There is also a deliberate ~5 second gap between paid calls: concurrent payments
collide on EIP-3009 nonces, so calls are serialised. A find → quote → order sequence
takes roughly 15 seconds and can read as a hang. That is expected.

### Not supported — do not file these

- **Non-EVM signing.** The signing page uses `window.ethereum`. Solana, Sui, TON and
  Bitcoin DEX swaps hand you the transaction to submit yourself.
- **Mobile.** A phone cannot reach a loopback port on your laptop. WalletConnect is
  future work.
- **Headless.** Signing needs a human at a browser.
- **Approvals via `dexSignRequest`.** Approvals happen before an order exists, so
  there is nothing to bind the request to.
- **No free tool.** First run without a funded wallet fails on every call. Known and
  intentional; a product decision, not a defect.
- **A DEX order's `outAmount` is the quote, not the settlement.** It is never
  reconciled after the swap, so it reads a hair high — 0.002929681 against a
  delivered 0.002929389 in one measured case. CEX and private orders *do* reconcile
  exactly, so the mismatch is DEX-only. Backend ticket; check the chain, not the
  field.
- **Other people's orders in `getOrders`.** See the note at the top of this guide.
- **A DEX revert one to two minutes after ordering.** Expected; see the box above
  T9. Only file it if it happens when you sign *promptly*.

---

## Filing a bug

What to capture so it can be reproduced without a second round trip.

1. **Running version** — from the npx cache path, not the changelog. Half of the
   "it's broken" reports in development were a stale process.
2. **The `houdiniId`** for anything order-related. It makes the whole flow traceable
   server-side.
3. **The transaction hash** if one was broadcast, plus the Basescan link.
4. **The exact tool call and full response**, not a summary. Parameter names have been
   the root cause more than once.
5. **Both sides of a signing failure** — what the page showed and what the assistant
   reported. They can disagree, and the disagreement is the bug.
6. **Whether funds moved.** Always check the wallet rather than trusting the reported
   status.

> **Priority steer.** Anything where a **failed swap is reported as successful**, or
> where **funds move and the system loses track of them**, outranks everything else
> here. Those are the two failure modes this whole surface is built to prevent.

---

See also [`local-signing.md`](./local-signing.md) for the browser-signing design and
threat model.
