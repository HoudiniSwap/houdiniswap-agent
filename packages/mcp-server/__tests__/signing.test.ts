import { describe, it, expect, afterEach } from "vitest";
import { SigningServer } from "../src/signing/server.js";
import { Script } from "node:vm";
import { connect } from "node:net";
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

/**
 * Browsers set Origin on every request whose method is not GET or HEAD, so the
 * signing page always sends one and the server now requires it. This models
 * that; `noOrigin` below covers the client that does not.
 */
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Origin: new URL(url).origin,
            ...headers,
        },
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

    // The sequential single-use test above passes either way, because the body
    // arrives before the next request's headers are parsed. Holding the bodies
    // back lets every request clear the status check first, which is how three
    // submissions were all accepted and the last hash overwrote the first.
    it("is single use even when submissions interleave", async () => {
        const s = make();
        const { token } = await s.request("H1", TX, 8453, later());
        const port = s.getPort() as number;

        const submit = (hash: string) =>
            new Promise<string>((resolve) => {
                const body = JSON.stringify({ txHash: hash });
                const sock = connect(port, "127.0.0.1", () => {
                    sock.write(
                        `POST /sign/${token} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
                            `Content-Type: application/json\r\nOrigin: http://127.0.0.1:${port}\r\n` +
                            `Content-Length: ${body.length}\r\n\r\n`,
                    );
                    // every set of headers lands before any body does
                    setTimeout(() => sock.end(body), 150);
                });
                let resp = "";
                sock.on("data", (d) => {
                    resp += d;
                });
                sock.on("close", () => resolve(resp.split("\r\n")[0]));
            });

        const hashes = ["a", "b", "c"].map((ch) => `0x${ch.repeat(64)}`);
        const statuses = await Promise.all(hashes.map(submit));
        expect(statuses.filter((s2) => s2.includes("200"))).toHaveLength(1);
        expect(statuses.filter((s2) => s2.includes("409"))).toHaveLength(2);
        // whichever won, it must be one that was actually submitted, and it must
        // not have been replaced afterwards
        expect(hashes).toContain(s.status(token)?.txHash);
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

    // docs/local-signing.md said "requires ... a same-origin Origin header;
    // anything else is rejected", but the check only fired when the header was
    // present, so a raw socket omitting it was accepted.
    it("refuses a submission with no Origin at all", async () => {
        const s = make();
        const { url, token } = await s.request("H1", TX, 8453, later());
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ txHash: HASH }),
        });
        expect(res.status).toBe(403);
        expect(s.status(token)?.status).toBe("pending");
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

    // BigInt throws on anything that is not an integer literal, and this runs
    // inside the HTTP request listener — so it was an uncaughtException that
    // killed the whole MCP server, taking the pending map with it. "1e+21" is
    // what JSON.stringify produces for a large number that went through a
    // float, so a real order could reach it.
    it("renders an unreadable value instead of throwing", async () => {
        const s = make();
        const { url } = await s.request("H1", { ...TX, value: "1e+21" }, 8453, later());
        const res = await fetch(url);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("UNREADABLE");
    });

    // Defence in depth for whatever the next unrenderable field turns out to
    // be. `data` is filtered by dexSignRequest, so this reaches the server the
    // way a future gap would: through request() directly.
    it("answers 500 and stays alive when rendering throws", async () => {
        const s = make();
        const broken = { to: TX.to, value: "0" } as unknown as typeof TX;
        const { url } = await s.request("H1", broken, 8453, later());
        expect((await fetch(url)).status).toBe(500);
        // the process is still here, and so is the listener
        const ok = await s.request("H2", TX, 8453, later());
        expect((await fetch(ok.url)).status).toBe(200);
    });

    it("says so in the page rather than showing a wrong amount", () => {
        const html = renderSignPage({ ...TX, value: "1.5" }, 8453, "H1", "t".repeat(64));
        expect(html).toContain("UNREADABLE");
        expect(html).toContain("do not sign");
    });

    // The chain does not care that our quote lapsed. If the user was still in
    // their wallet when it expired, the transaction is on-chain and the hash
    // has to be recordable — otherwise dexSignStatus tells them the token is
    // unknown and invites them to pay for a second swap they already made.
    it("still records a signature that arrives after expiry", async () => {
        const s = make();
        const { url, token } = await s.request("H1", TX, 8453, Date.now() - 1000);
        expect(s.status(token)?.status).toBe("expired");
        expect((await fetch(url)).status).toBe(404); // page is not served any more
        expect((await post(url, { txHash: HASH })).status).toBe(200);
        expect(s.status(token)?.status).toBe("signed");
        expect(s.status(token)?.txHash).toBe(HASH);
    });

    // req.destroy() alone meant 'end' never fired and no response was ever
    // sent, so the page's report() saw a socket error, swallowed it, and the
    // agent polled a request that stayed pending forever.
    it("answers an oversize body instead of hanging up silently", async () => {
        const s = make();
        const { url, token } = await s.request("H1", TX, 8453, later());
        const res = await post(url, { txHash: HASH, junk: "x".repeat(20_000) }).catch(() => undefined);
        expect(res?.status).toBe(413);
        expect(s.status(token)?.status).toBe("pending");
    });

    // Two dexSignRequest calls in flight together both saw no port and both
    // bound. Only the second was remembered, so the first page's own POST was
    // judged cross-origin and refused after the user had already signed.
    it("binds one listener when requests are concurrent", async () => {
        const s = make();
        const [a, b] = await Promise.all([
            s.request("A", TX, 8453, later()),
            s.request("B", TX, 8453, later()),
        ]);
        expect(new URL(a.url).port).toBe(new URL(b.url).port);
        expect(new URL(a.url).port).toBe(String(s.getPort()));
        // both pages can report, which is what the second listener broke
        expect((await post(a.url, { txHash: HASH })).status).toBe(200);
        expect((await post(b.url, { txHash: `0x${"b".repeat(64)}` })).status).toBe(200);
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

    // Both of these were found by signing a real swap, not by reading the code.
    it("sends an explicit gas limit rather than letting the wallet guess", () => {
        const html = renderSignPage(TX, 8453, "H1", "t".repeat(64));
        // match the calls, not prose mentioning them
        const estimateAt = html.indexOf('method: "eth_estimateGas"');
        const sendAt = html.indexOf('method: "eth_sendTransaction"');
        expect(estimateAt).toBeGreaterThan(-1);
        expect(sendAt).toBeGreaterThan(-1);
        // the estimate must be requested before the send, or there is nothing to pass
        expect(estimateAt).toBeLessThan(sendAt);
        expect(html).toMatch(/params:\s*\[\{\s*\.\.\.call,\s*gas\s*\}\]/);
    });

    // Evaluates the helper exactly as shipped: the API sends decimal strings,
    // eth_sendTransaction wants hex, and "0" hides the difference.
    it("converts the value to a hex quantity", () => {
        const html = renderSignPage(TX, 8453, "H1", "t".repeat(64));
        const src = /const toQuantity = \(v\) => \{[\s\S]*?\n      \};/.exec(html)?.[0];
        expect(src, "toQuantity not found in the page").toBeTruthy();
        const toQuantity = new Script(`${src} toQuantity`).runInNewContext() as (v: unknown) => string;

        expect(toQuantity("2740000000000000")).toBe("0x9bc03f6af4000");
        expect(toQuantity("0")).toBe("0x0");
        expect(toQuantity(undefined)).toBe("0x0");
        expect(toQuantity("")).toBe("0x0");
        expect(toQuantity("0x00")).toBe("0x00");
        // the bug: a decimal string read as hex is ~4000x the intended amount
        expect(toQuantity("2740000000000000")).not.toBe("2740000000000000");
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
