import { describe, it, expect } from "vitest";
import { runInNewContext } from "node:vm";
import { renderSignPage } from "../src/signing/page.js";

/**
 * The signing page's JavaScript is emitted as a string, so every test that
 * inspects it was really a string assertion — and a mutation audit showed the
 * consequences: deleting the account check, inverting the chain comparison,
 * dropping the hex conversion at the call site and un-hex-encoding the chain id
 * all left the suite green. Those are the guards that decide what a wallet is
 * asked to sign.
 *
 * So run the script instead of reading it. The IIFE is evaluated against a
 * stubbed window.ethereum, and the assertions are about what reaches the
 * wallet.
 */

const TX = {
    from: "0xe75b49d793c835Caf6754C63AF2f0d472e537D73",
    to: "0xac4c6e212a361c968f1725b4d055b47e63f80b75",
    data: `0x5f3bd1c8${"0".repeat(200)}`,
    value: "2740000000000000", // decimal, as the API sends it
};

interface WalletCall {
    method: string;
    params?: unknown[];
}

interface Harness {
    calls: WalletCall[];
    reports: unknown[];
    status: () => string;
    click: () => Promise<void>;
}

/**
 * Evaluates the page's inline script with a fake wallet and DOM.
 * `wallet` maps an RPC method to its result, or to a thrown error.
 */
const load = (
    page: string,
    wallet: Record<string, unknown | (() => unknown)>,
    accounts: string[] = [TX.from],
): Harness => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(page)?.[1];
    if (!script) throw new Error("no script block in the rendered page");

    const calls: WalletCall[] = [];
    const reports: unknown[] = [];
    let statusText = "";
    let handler: (() => Promise<void>) | undefined;

    const el = () => ({
        addEventListener: (_: string, fn: () => Promise<void>) => {
            handler = fn;
        },
        set textContent(v: string) {
            statusText = v;
        },
        get textContent() {
            return statusText;
        },
        className: "",
        disabled: false,
    });

    const sandbox = {
        document: { getElementById: () => el() },
        location: { pathname: "/sign/" + "t".repeat(64) },
        fetch: async (_url: string, init?: { body?: string }) => {
            reports.push(JSON.parse(init?.body ?? "{}"));
            return { ok: true };
        },
        window: {
            ethereum: {
                request: async (args: WalletCall) => {
                    calls.push(args);
                    if (args.method === "eth_requestAccounts") return accounts;
                    const entry = wallet[args.method];
                    if (typeof entry === "function") return (entry as () => unknown)();
                    return entry;
                },
            },
        },
        console,
        BigInt,
        JSON,
        String,
        Number,
        setTimeout,
    };

    runInNewContext(script, sandbox);
    if (!handler) throw new Error("the page never registered a click handler");

    return { calls, reports, status: () => statusText, click: () => handler!() };
};

const page = (tx = TX, chainId = 8453) => renderSignPage(tx, chainId, "H1", "t".repeat(64));

describe("what the page actually hands the wallet", () => {
    const happy = {
        eth_chainId: "0x2105", // Base, already correct
        eth_estimateGas: "0x30d40", // 200000
        eth_sendTransaction: `0x${"a".repeat(64)}`,
        eth_getBalance: "0x2386f26fc10000", // 1e16 wei — comfortably covers TX
        eth_gasPrice: "0x5b8d80", // 6_000_000 wei
    };

    // The bug this exists for: the API sends value as a decimal string and
    // eth_sendTransaction wants a hex quantity. "2740000000000000" read as hex
    // is ~4000x the intended amount. A test that evaluates the helper in
    // isolation does not notice when it stops being applied at the call site.
    it("sends value as a hex quantity, not the decimal string", async () => {
        const h = load(page(), happy);
        await h.click();
        const send = h.calls.find((c) => c.method === "eth_sendTransaction");
        const params = send?.params?.[0] as { value: string };
        expect(params.value).toBe("0x9bc03f6af4000");
        expect(BigInt(params.value)).toBe(2_740_000_000_000_000n);
    });

    // Left to fill it in itself, a wallet whose estimate does not arrive
    // substitutes a block-sized default — 140,000,000 against Base's 25,000,000
    // cap — and the RPC rejects the send after the user has approved it.
    it("estimates gas and passes an explicit limit with a buffer", async () => {
        const h = load(page(), happy);
        await h.click();
        expect(h.calls.map((c) => c.method)).toContain("eth_estimateGas");
        const send = h.calls.find((c) => c.method === "eth_sendTransaction");
        const gas = (send?.params?.[0] as { gas: string }).gas;
        expect(BigInt(gas)).toBe(240_000n); // 200000 * 1.2
    });

    it("asks the wallet to switch only when it is on the wrong chain", async () => {
        const right = load(page(), happy);
        await right.click();
        expect(right.calls.map((c) => c.method)).not.toContain("wallet_switchEthereumChain");

        const wrong = load(page(), { ...happy, eth_chainId: "0x1" });
        await wrong.click();
        const sw = wrong.calls.find((c) => c.method === "wallet_switchEthereumChain");
        expect(sw).toBeTruthy();
        // hex-encoded: "0x" + 8453 would be 0x8453, a different chain entirely
        expect((sw?.params?.[0] as { chainId: string }).chainId).toBe("0x2105");
    });

    it("refuses to sign from an account the order was not built for", async () => {
        const h = load(page(), happy, ["0x000000000000000000000000000000000000dEaD"]);
        await h.click();
        expect(h.calls.map((c) => c.method)).not.toContain("eth_sendTransaction");
        expect(h.status().toLowerCase()).toContain("switch accounts");
    });

    it("reports the hash back so the agent can confirm it", async () => {
        const h = load(page(), happy);
        await h.click();
        expect(h.reports).toContainEqual({ txHash: `0x${"a".repeat(64)}` });
    });

    it("posts the content-type and body the server will accept", () => {
        const html = page();
        // acceptResult 415s anything else, and the page's own fetch is the only
        // caller — the two are only correct together.
        expect(html).toContain('"Content-Type": "application/json"');
        expect(html).toContain("location.pathname");
    });

    it("reports a failed estimate instead of sending anyway", async () => {
        const h = load(page(), {
            ...happy,
            eth_estimateGas: () => {
                throw Object.assign(new Error("execution reverted: STF"), {
                    data: { message: "execution reverted: STF" },
                });
            },
        });
        await h.click();
        expect(h.calls.map((c) => c.method)).not.toContain("eth_sendTransaction");
        const report = h.reports[0] as { error: string };
        expect(report.error).toContain("gas estimation failed");
        expect(h.status()).toContain("would fail on-chain");
    });

    // A native CEX deposit is sized to the order, not to the wallet, so a user
    // depositing "everything" has nothing left for gas. A cross-chain swap is
    // the same shape: the bridge fee rides on top of value. Measured live —
    // a 0.0059 ETH order carried value 0.005929… and left 140k gas affordable
    // against a 480k requirement, which fails inside the wallet.
    it("refuses when the balance cannot cover value plus gas", async () => {
        const h = load(page(), {
            ...happy,
            eth_getBalance: "0x9bc03f6af4000", // exactly the value, nothing for gas
        });
        await h.click();
        expect(h.calls.map((c) => c.method)).not.toContain("eth_sendTransaction");
        const report = h.reports[0] as { error: string };
        expect(report.error).toContain("short by");
        expect(h.status()).toContain("ETH"); // names the chain's own coin
    });

    it("sends when the balance covers value plus gas", async () => {
        const h = load(page(), happy);
        await h.click();
        expect(h.calls.map((c) => c.method)).toContain("eth_sendTransaction");
    });

    // The check is a courtesy, not a gate: a wallet that will not answer these
    // must not block a transaction that already estimated cleanly.
    it("still sends when the wallet refuses to report a balance", async () => {
        const h = load(page(), {
            ...happy,
            eth_getBalance: () => {
                throw new Error("unsupported method");
            },
        });
        await h.click();
        expect(h.calls.map((c) => c.method)).toContain("eth_sendTransaction");
    });

    it("reports a user rejection rather than leaving the agent polling", async () => {
        const h = load(page(), {
            ...happy,
            eth_sendTransaction: () => {
                throw new Error("User rejected the request.");
            },
        });
        await h.click();
        expect(h.reports).toContainEqual({ error: "User rejected the request." });
    });

    // A hostile route controls the revert string, and it lands in the agent's
    // context. Cap it at the source.
    it("caps a wallet error before posting it", async () => {
        const h = load(page(), {
            ...happy,
            eth_estimateGas: () => {
                throw new Error("x".repeat(5000));
            },
        });
        await h.click();
        const report = h.reports[0] as { error: string };
        expect(report.error.length).toBeLessThan(400);
    });
});
