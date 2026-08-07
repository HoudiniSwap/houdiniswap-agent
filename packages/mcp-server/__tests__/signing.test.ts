import { describe, it, expect, afterEach } from "vitest";
import { SigningServer } from "../src/signing/server.js";
import { Script } from "node:vm";
import { summarise, renderSignPage } from "../src/signing/page.js";

/**
 * The signer holds no key and no funds, but it decides what a user is asked to
 * sign — so the access controls are the feature, not an implementation detail.
 * See docs/local-signing.md.
 */

const TX = {
    from: "0xe75b49d793c835Caf6754C63AF2f0d472e537D73",
    to: "0xac4c6e212a361c968f1725b4d055b47e63f80b75",
    data: `0x5f3bd1c8${"0".repeat(200)}`,
    value: "2740000000000000",
};
const HASH = `0x${"a".repeat(64)}`;
const later = () => Date.now() + 60_000;

let servers: SigningServer[] = [];
const make = () => {
    const s = new SigningServer();
    servers.push(s);
    return s;
};
afterEach(async () => {
    await Promise.all(servers.map((s) => s.close()));
    servers = [];
});

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
    });

describe("signing server", () => {
    it("binds loopback on an ephemeral port", async () => {
        const s = make();
        const { url } = await s.request("H1", TX, 8453, later());
        expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/sign\/[0-9a-f]{64}$/);
        expect(s.getPort()).toBeGreaterThan(0);
    });

    it("does not open a port until a signature is requested", async () => {
        const s = make();
        expect(s.getPort()).toBeUndefined();
    });

    it("serves the page for a valid token", async () => {
        const s = make();
        const { url } = await s.request("H1", TX, 8453, later());
        const res = await fetch(url);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Sign your swap");
        expect(html).toContain(TX.to);
    });

    // Without this, any local process could put a transaction in front of the user.
    it("404s an unknown token", async () => {
        const s = make();
        await s.request("H1", TX, 8453, later());
        const res = await fetch(`http://127.0.0.1:${s.getPort()}/sign/${"f".repeat(64)}`);
        expect(res.status).toBe(404);
    });

    it("404s a malformed token rather than revealing the route shape", async () => {
        const s = make();
        await s.request("H1", TX, 8453, later());
        for (const bad of ["/sign/short", "/sign/../../etc/passwd", "/", "/sign/"]) {
            expect((await fetch(`http://127.0.0.1:${s.getPort()}${bad}`)).status).toBe(404);
        }
    });

    it("accepts a signature and reports it", async () => {
        const s = make();
        const { url, token } = await s.request("H1", TX, 8453, later());
        expect((await post(url, { txHash: HASH })).status).toBe(200);
        const status = s.status(token);
        expect(status?.status).toBe("signed");
        expect(status?.txHash).toBe(HASH);
    });

    it("records a rejection with its reason", async () => {
        const s = make();
        const { url, token } = await s.request("H1", TX, 8453, later());
        await post(url, { error: "User rejected the request." });
        expect(s.status(token)?.status).toBe("rejected");
        expect(s.status(token)?.error).toContain("rejected");
    });

    it("is single use — a second submission conflicts", async () => {
        const s = make();
        const { url } = await s.request("H1", TX, 8453, later());
        expect((await post(url, { txHash: HASH })).status).toBe(200);
        expect((await post(url, { txHash: `0x${"b".repeat(64)}` })).status).toBe(409);
    });

    it("rejects a hash that is not a 32-byte hex value", async () => {
        const s = make();
        const { url, token } = await s.request("H1", TX, 8453, later());
        for (const bad of ["nope", "0x123", 42, null]) {
            expect((await post(url, { txHash: bad })).status).toBe(400);
        }
        expect(s.status(token)?.status).toBe("pending");
    });

    // A browser will not send this content-type cross-origin without a preflight,
    // which is never answered — so a hostile page cannot resolve a request even
    // if it somehow learned the token.
    it("refuses a submission without a JSON content-type", async () => {
        const s = make();
        const { url } = await s.request("H1", TX, 8453, later());
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({ txHash: HASH }),
        });
        expect(res.status).toBe(415);
    });

    it("refuses a cross-origin submission", async () => {
        const s = make();
        const { url } = await s.request("H1", TX, 8453, later());
        const res = await post(url, { txHash: HASH }, { Origin: "https://evil.example" });
        expect(res.status).toBe(403);
    });

    it("expires a request and stops serving it", async () => {
        const s = make();
        const { url, token } = await s.request("H1", TX, 8453, Date.now() - 1);
        expect(s.status(token)?.status).toBe("expired");
        expect((await fetch(url)).status).toBe(404);
    });

    it("keeps separate requests independent", async () => {
        const s = make();
        const a = await s.request("H1", TX, 8453, later());
        const b = await s.request("H2", TX, 8453, later());
        await post(a.url, { txHash: HASH });
        expect(s.status(a.token)?.status).toBe("signed");
        expect(s.status(b.token)?.status).toBe("pending");
    });

    it("caps the request body", async () => {
        const s = make();
        const { url, token } = await s.request("H1", TX, 8453, later());
        await post(url, { txHash: HASH, junk: "x".repeat(20_000) }).catch(() => undefined);
        expect(s.status(token)?.status).not.toBe("signed");
    });
});

describe("signing page", () => {
    it("embeds the transaction server-side rather than taking it from the URL", () => {
        const html = renderSignPage(TX, 8453, "H1", "t".repeat(64));
        expect(html).toContain(TX.data);
        expect(html).toContain('"chainId":8453');
    });

    it("forbids loading anything remote", () => {
        const html = renderSignPage(TX, 8453, "H1", "t".repeat(64));
        expect(html).not.toMatch(/<script[^>]+src=/);
        expect(html).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
    });

    it("escapes values interpolated into the markup", () => {
        const html = renderSignPage(TX, 8453, '"><script>alert(1)</script>', "t".repeat(64));
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).toContain("&lt;script&gt;");
    });

    // A syntax error here is invisible: the button does nothing and no error
    // reaches the agent or the logs. Escaping is what most likely breaks it,
    // so the hostile input is checked too.
    it("emits a script that parses, including with hostile input", () => {
        for (const id of ["H1", '"><script>alert(1)</script>', "a b", "it's \\ \"quoted\""]) {
            const html = renderSignPage({ ...TX, data: `0x${id}` }, 8453, id, "t".repeat(64));
            const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
            expect(script, `no script block for ${id}`).toBeTruthy();
            // Script compiles without running — a parse check, not an eval.
            expect(() => new Script(script as string), `parse failure for ${id}`).not.toThrow();
        }
    });

    it("summarises what is being signed", () => {
        const rows = summarise(TX, 8453);
        const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
        expect(byLabel.Network).toContain("Base");
        expect(byLabel.Contract).toBe(TX.to);
        expect(byLabel["Native value sent"]).toContain("0.00274");
    });

    it("says plainly when no native value is sent", () => {
        const rows = summarise({ ...TX, value: "0" }, 8453);
        expect(rows.find((r) => r.label === "Native value sent")?.value).toBe("none");
    });

    // Router calldata cannot be decoded without each router's ABI, so what the
    // swap actually does comes from the order.
    it("shows what the swap does, from the order", () => {
        const rows = summarise(TX, 8453, {
            inAmount: 0.00274,
            inSymbol: "ETH",
            outAmount: 5.2,
            outSymbol: "USDC",
            receiverAddress: "0xe75b49d793c835Caf6754C63AF2f0d472e537D73",
        });
        const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.value]));
        expect(byLabel["You send"]).toBe("0.00274 ETH");
        expect(byLabel["You receive (est.)"]).toBe("5.2 USDC");
        expect(byLabel.Recipient).toBe("0xe75b49d793c835Caf6754C63AF2f0d472e537D73");
    });

    // DEX orders return a token id where a ticker belongs; showing the raw
    // ObjectId would read as a token name and mislead.
    it("omits a symbol that is really a token id", () => {
        const rows = summarise(TX, 8453, { inAmount: 1, inSymbol: "6683d3e8ff3b1a0014b8a2c1" });
        const send = rows.find((r) => r.label === "You send")?.value;
        expect(send).toBe("1");
        expect(send).not.toContain("6683d3e8");
    });

    it("falls back to the transaction alone when the order says nothing", () => {
        const labels = summarise(TX, 8453).map((r) => r.label);
        expect(labels).not.toContain("You send");
        expect(labels).toContain("Contract");
    });
});
