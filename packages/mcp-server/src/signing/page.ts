export interface SignableTransaction {
    from?: string;
    to: string;
    data: string;
    value?: string;
    gasPrice?: number | string;
}

export interface DecodedSummary {
    label: string;
    value: string;
}

/** The parts of the order worth showing next to the raw transaction. */
export interface OrderFacts {
    inAmount?: number;
    inSymbol?: string;
    outAmount?: number;
    outSymbol?: string;
    receiverAddress?: string;
}

/**
 * DEX orders come back with a token *id* in inSymbol/outSymbol rather than a
 * ticker, and printing an ObjectId where a user expects "USDC" is worse than
 * printing nothing. Backend ticket open; until then, treat it as absent.
 */
const asTicker = (s: string | undefined): string | undefined =>
    s && !/^[0-9a-f]{24}$/i.test(s) ? s : undefined;

/** Escapes text before it is interpolated into the page. */
const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CHAIN_NAMES: Record<number, string> = {
    1: "Ethereum Mainnet",
    10: "Optimism",
    56: "BNB Smart Chain",
    137: "Polygon",
    8453: "Base",
    42161: "Arbitrum",
    43114: "Avalanche",
};

/**
 * A summary the user can check *before* the wallet opens. The wallet shows its
 * own review on top of this; the point here is that the amounts and addresses
 * are legible rather than hidden in calldata.
 */
export const summarise = (
    tx: SignableTransaction,
    chainId: number,
    order: OrderFacts = {},
): DecodedSummary[] => {
    const rows: DecodedSummary[] = [
        { label: "Network", value: `${CHAIN_NAMES[chainId] ?? "chain " + chainId} (${chainId})` },
    ];

    // Order-derived facts first: this is what the user actually cares about, and
    // unlike the calldata it needs no router ABI to read. Each router encodes its
    // swap differently, so decoding `data` generically is not on the table.
    const inTicker = asTicker(order.inSymbol);
    const outTicker = asTicker(order.outSymbol);
    if (order.inAmount !== undefined) {
        rows.push({ label: "You send", value: `${order.inAmount}${inTicker ? ` ${inTicker}` : ""}` });
    }
    if (order.outAmount !== undefined) {
        rows.push({
            label: "You receive (est.)",
            value: `${order.outAmount}${outTicker ? ` ${outTicker}` : ""}`,
        });
    }
    if (order.receiverAddress) rows.push({ label: "Recipient", value: order.receiverAddress });

    rows.push({ label: "Contract", value: tx.to });
    const value = BigInt(tx.value ?? "0");
    rows.push({
        label: "Native value sent",
        value: value === 0n ? "none" : `${(Number(value) / 1e18).toFixed(8)} (native units)`,
    });
    rows.push({ label: "Calldata", value: `${tx.data.slice(0, 34)}… (${tx.data.length - 2} hex chars)` });
    return rows;
};

export const renderSignPage = (
    tx: SignableTransaction,
    chainId: number,
    houdiniId: string,
    token: string,
    order: OrderFacts = {},
): string => {
    const rows = summarise(tx, chainId, order)
        .map((r) => `<tr><th>${esc(r.label)}</th><td>${esc(r.value)}</td></tr>`)
        .join("");

    // The transaction is embedded server-side. The page never takes one from the
    // URL or from a message, so nothing a third party controls can be signed.
    //
    // JSON.stringify does NOT escape `</script>`, so a value containing it would
    // close the script block and everything after it would be parsed as markup.
    // Escaping the three characters that can start a tag or an entity — plus the
    // two line separators that are literal in JSON but terminators in JS —
    // makes the payload safe to inline. Caught by its own test, having written
    // the bug first.
    const payload = JSON.stringify({ tx, chainId, token, houdiniId })
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign swap · HoudiniSwap</title>
<style>
  :root { color-scheme: light dark; --fg:#111; --muted:#666; --bg:#fff; --card:#f6f6f7; --line:#e3e3e6; --accent:#2b6cff; --ok:#0a7c42; --bad:#b3261e; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e9e9ea; --muted:#9b9ba0; --bg:#141416; --card:#1d1d20; --line:#2c2c31; --accent:#6f9bff; --ok:#4ade80; --bad:#ff6b6b; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:2rem 1rem; background:var(--bg); color:var(--fg);
         font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width:44rem; margin:0 auto; }
  h1 { font-size:1.35rem; margin:0 0 .35rem; }
  .sub { color:var(--muted); margin:0 0 1.5rem; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:1rem 1.15rem; margin-bottom:1.15rem; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; color:var(--muted); font-weight:500; padding:.4rem .75rem .4rem 0; white-space:nowrap; vertical-align:top; width:11rem; }
  td { padding:.4rem 0; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; word-break:break-all; }
  button { font:inherit; font-weight:600; padding:.7rem 1.3rem; border-radius:9px; border:0; cursor:pointer;
           background:var(--accent); color:#fff; }
  button:disabled { opacity:.5; cursor:default; }
  #status { margin-top:1rem; min-height:1.5rem; }
  .ok { color:var(--ok); } .bad { color:var(--bad); }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; }
  .note { color:var(--muted); font-size:13px; margin-top:1.5rem; border-top:1px solid var(--line); padding-top:1rem; }
</style>
</head>
<body>
<main>
  <h1>Sign your swap</h1>
  <p class="sub">Order <code>${esc(houdiniId)}</code> · your wallet will show its own confirmation before anything is sent.</p>

  <div class="card">
    <table>${rows}</table>
  </div>

  <button id="go">Connect wallet and sign</button>
  <div id="status"></div>

  <p class="note">
    This page is served by the HoudiniSwap MCP server on your own machine and cannot be reached from
    anywhere else. It never sees your private key — the transaction is handed to your wallet, which
    signs it. Review the details in your wallet as well as here before approving.
  </p>
</main>
<script>
(() => {
  const { tx, chainId, token } = ${payload};
  const btn = document.getElementById("go");
  const out = document.getElementById("status");
  const say = (msg, cls) => { out.textContent = msg; out.className = cls || ""; };

  const report = (body) =>
    fetch(location.pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});

  btn.addEventListener("click", async () => {
    if (!window.ethereum) {
      say("No wallet extension found in this browser. Install MetaMask (or similar) and reload.", "bad");
      return;
    }
    btn.disabled = true;
    try {
      say("Waiting for you to connect…");
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const from = (tx.from || accounts[0] || "").toLowerCase();
      if (accounts[0] && from && accounts[0].toLowerCase() !== from) {
        say("This order was created for " + from + " but your wallet is on " + accounts[0] + ". Switch accounts and reload.", "bad");
        btn.disabled = false;
        return;
      }

      const want = "0x" + chainId.toString(16);
      const current = await window.ethereum.request({ method: "eth_chainId" });
      if (current !== want) {
        say("Asking your wallet to switch network…");
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
      }

      say("Confirm the transaction in your wallet…");
      const txHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from: accounts[0], to: tx.to, data: tx.data, value: tx.value || "0x0" }],
      });

      await report({ txHash });
      say("Sent. You can close this tab — the agent is tracking it now. " + txHash, "ok");
    } catch (err) {
      const message = (err && (err.message || String(err))) || "unknown error";
      await report({ error: message });
      say(message, "bad");
      btn.disabled = false;
    }
  });
})();
</script>
</body>
</html>`;
};
