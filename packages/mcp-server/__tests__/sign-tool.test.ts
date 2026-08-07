import { describe, it, expect, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { HoudiniClient } from "@houdiniswap/agent-shared";
import { registerSigningTools } from "../src/tools/sign.js";
import { SigningServer } from "../src/signing/server.js";

/**
 * The order below is a real GET /orders/:id response (trimmed), not one written
 * to suit the code. An invented order is what let the chainId bug ship: the
 * mock flattened chainId onto the token, the live API nests it under chainData,
 * and every dexSignRequest failed with "could not determine the chain".
 */
const RAW_ORDER = {
    houdiniId: "uUYQpvRARQpSEfhY4MBCFA",
    status: 0,
    isDex: true,
    // Relative, not the timestamp this order really carried. Copying that
    // verbatim made the suite pass on the day and 404 forever after, because
    // the signer stops serving an expired request.
    expires: new Date(Date.now() + 30 * 60_000).toISOString(),
    receiverAddress: "0xe75b49d793c835Caf6754C63AF2f0d472e537D73",
    inAmount: 5.5,
    // DEX orders carry token ids here, not tickers
    inSymbol: "6689b757c90e45f3b3e51805",
    outAmount: 0.00289546111840948,
    outSymbol: "6689b73ec90e45f3b3e51590",
    // a JSON string on read-back, an object on creation
    metadata:
        '{"from":"0xe75b49d793c835Caf6754C63AF2f0d472e537D73","to":"0xac4c6e212a361c968f1725b4d055b47e63f80b75","gasPrice":6000000,"data":"0x5f3bd1c800000000","value":"0"}',
    inToken: {
        symbol: "USDC",
        address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        decimals: 6,
        chainData: { name: "Base", shortName: "base", kind: "evm", chainId: 8453 },
    },
    outToken: {
        symbol: "ETH",
        address: null,
        decimals: 18,
        chainData: { name: "Base", shortName: "base", kind: "evm", chainId: 8453 },
    },
};

const stubClient = (order: unknown): HoudiniClient =>
    ({ get: async () => order, post: async () => ({}) }) as unknown as HoudiniClient;

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
    await close?.();
    close = undefined;
});

const callSign = async (order: unknown, args: Record<string, unknown> = { houdiniId: "uUYQpvRARQpSEfhY4MBCFA" }) => {
    const server = new McpServer({ name: "t", version: "1" });
    const signer = registerSigningTools(server, stubClient(order));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: "t", version: "1" }, { capabilities: {} });
    await client.connect(ct);
    close = async () => {
        await signer.close();
        await client.close();
    };
    const res = await client.callTool({ name: "dexSignRequest", arguments: args });
    return JSON.parse((res.content as Array<{ text: string }>)[0].text);
};

describe("dexSignRequest against the real order shape", () => {
    it("reads chainId from chainData, where the API actually puts it", async () => {
        const out = await callSign(RAW_ORDER);
        expect(out.error).toBeUndefined();
        expect(out.chainId).toBe(8453);
        expect(out.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/sign\/[0-9a-f]{64}$/);
    });

    // createExchange returns the shaped order, which flattens chainId instead.
    it("still works when chainId is flattened onto the token", async () => {
        const flat = { ...RAW_ORDER, inToken: { symbol: "USDC", chainId: 8453 } };
        expect((await callSign(flat)).chainId).toBe(8453);
    });

    it("parses metadata that arrives as a JSON string", async () => {
        const out = await callSign(RAW_ORDER);
        const page = await fetch(out.url).then((r) => r.text());
        expect(page).toContain("0xac4c6e212a361c968f1725b4d055b47e63f80b75");
    });

    it("shows tickers from the token documents, not the id in inSymbol", async () => {
        const out = await callSign(RAW_ORDER);
        const page = await fetch(out.url).then((r) => r.text());
        expect(page).toContain("5.5 USDC");
        expect(page).toContain("0.00289546111840948 ETH");
        expect(page).not.toContain("6689b757c90e45f3b3e51805");
    });

    it("refuses a CEX order rather than inventing a transaction", async () => {
        const out = await callSign({ ...RAW_ORDER, isDex: false });
        expect(out.error).toContain("not a DEX order");
        expect(out.url).toBeUndefined();
    });

    it("reports plainly when the order carries no transaction", async () => {
        const out = await callSign({ ...RAW_ORDER, metadata: undefined });
        expect(out.error).toContain("no signable transaction");
    });

    it("reports plainly when the chain cannot be determined", async () => {
        const out = await callSign({ ...RAW_ORDER, inToken: { symbol: "USDC" } });
        expect(out.error).toContain("Could not determine the chain");
    });
});

describe("signer sharing", () => {
    // The HTTP transport builds a fresh McpServer per request. A signer created
    // inside registerSigningTools was discarded with it, so dexSignRequest and
    // the dexSignStatus that followed ran against different instances and the
    // token was always unknown — plus each request leaked a listening socket.
    it("uses the injected signer so state survives across servers", async () => {
        const shared = new SigningServer();
        const call = async (name: string, args: Record<string, unknown>) => {
            const server = new McpServer({ name: "t", version: "1" });
            registerSigningTools(server, stubClient(RAW_ORDER), shared);
            const [ct, st] = InMemoryTransport.createLinkedPair();
            await server.connect(st);
            const client = new Client({ name: "t", version: "1" }, { capabilities: {} });
            await client.connect(ct);
            const res = await client.callTool({ name, arguments: args });
            await client.close();
            return JSON.parse((res.content as Array<{ text: string }>)[0].text);
        };

        // request on one server instance...
        const req = await call("dexSignRequest", { houdiniId: RAW_ORDER.houdiniId });
        expect(req.token).toBeTruthy();
        // ...status on a different one, as the HTTP transport does
        const status = await call("dexSignStatus", { token: req.token });
        expect(status.status).toBe("pending");

        await shared.close();
    });

    it("mints its own signer when none is injected", async () => {
        const server = new McpServer({ name: "t", version: "1" });
        const signer = registerSigningTools(server, stubClient(RAW_ORDER));
        expect(signer).toBeInstanceOf(SigningServer);
        await signer.close();
    });
});

describe("swap composite on an unexpected envelope", () => {
    // GET /swaps returns a bare array where a wrapper was assumed, so a missing
    // key is not hypothetical. This used to surface as "Cannot read properties
    // of undefined (reading 'find')" rather than the clear message beside it.
    it("reports the token as not found rather than a TypeError", async () => {
        const server = new McpServer({ name: "t", version: "1" });
        const calls: string[] = [];
        const client = {
            get: async (path: string) => {
                calls.push(path);
                return path.startsWith("/tokens") ? { total: 0 } : {};
            },
            post: async () => ({}),
        } as unknown as HoudiniClient;

        const { registerSwapFlowTool } = await import("../src/tools/swap-flow.js");
        registerSwapFlowTool(server, client);
        const [ct, st] = InMemoryTransport.createLinkedPair();
        await server.connect(st);
        const c = new Client({ name: "t", version: "1" }, { capabilities: {} });
        await c.connect(ct);

        const res = await c.callTool({
            name: "swap",
            arguments: {
                fromSymbol: "BTC",
                fromChain: "bitcoin",
                toSymbol: "ETH",
                toChain: "ethereum",
                amount: 1,
                addressTo: "0xabc",
            },
        });
        const out = JSON.parse((res.content as Array<{ text: string }>)[0].text);
        expect(out.error).toContain("not found");
        expect(out.error).not.toContain("undefined");
        await c.close();
    });
});
