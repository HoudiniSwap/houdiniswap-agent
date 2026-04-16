import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/server.js";
import type { HoudiniClient } from "@houdiniswap/agent-shared";

// Mock HoudiniClient that records calls and returns configurable responses
class MockHoudiniClient {
    calls: Array<{ method: string; path: string; data?: unknown }> = [];
    private responses = new Map<string, unknown>();

    mockGet(pathPrefix: string, data: unknown) {
        this.responses.set(`GET:${pathPrefix}`, data);
    }

    mockPost(pathPrefix: string, data: unknown) {
        this.responses.set(`POST:${pathPrefix}`, data);
    }

    async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
        this.calls.push({ method: "GET", path, data: params });
        for (const [key, value] of this.responses) {
            if (key.startsWith("GET:") && path.startsWith(key.slice(4))) {
                return value as T;
            }
        }
        return {} as T;
    }

    async post<T>(path: string, body: unknown): Promise<T> {
        this.calls.push({ method: "POST", path, data: body });
        for (const [key, value] of this.responses) {
            if (key.startsWith("POST:") && path.startsWith(key.slice(5))) {
                return value as T;
            }
        }
        return {} as T;
    }

    getBaseUrl() {
        return "https://api-partner.houdiniswap.com/v2";
    }
}

// Stub global fetch for the openapi resource
vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response('{"openapi":"3.0.0"}', { status: 200 })),
);

let mockClient: MockHoudiniClient;
let mcpClient: Client;

const EXPECTED_TOOLS = [
    "getTokens",
    "getChains",
    "getQuote",
    "createExchange",
    "getOrder",
    "getOrders",
    "getSwapProviders",
    "getMinMax",
    "dexApprove",
    "dexCheckAllowance",
    "dexConfirmTx",
    "dexChainSignatures",
    "swap",
];

beforeAll(async () => {
    mockClient = new MockHoudiniClient();
    const server = createMcpServer(mockClient as unknown as HoudiniClient);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    mcpClient = new Client({ name: "test-client", version: "1.0.0" });
    await mcpClient.connect(clientTransport);
});

afterAll(async () => {
    await mcpClient.close();
});

beforeEach(() => {
    mockClient.calls = [];
});

describe("MCP Server", () => {
    describe("initialization", () => {
        it("registers all 13 tools (14 including swap)", async () => {
            const { tools } = await mcpClient.listTools();
            const toolNames = tools.map((t) => t.name).sort();
            expect(toolNames).toEqual(EXPECTED_TOOLS.sort());
        });

        it("registers resources", async () => {
            const { resources } = await mcpClient.listResources();
            const uris = resources.map((r) => r.uri);
            expect(uris).toContain("houdiniswap://openapi");
            expect(uris).toContain("houdiniswap://pricing");
        });
    });

    describe("getTokens", () => {
        it("calls GET /tokens with params", async () => {
            mockClient.mockGet("/tokens", { total: 1, tokens: [{ id: "t1", symbol: "BTC", chain: "bitcoin" }] });
            const result = await mcpClient.callTool({ name: "getTokens", arguments: { symbol: "BTC", hasCex: true } });
            expect(mockClient.calls).toContainEqual(
                expect.objectContaining({ method: "GET", path: "/tokens" }),
            );
            const content = JSON.parse((result.content as any)[0].text);
            expect(content.tokens[0].symbol).toBe("BTC");
        });
    });

    describe("getChains", () => {
        it("calls GET /chains with params", async () => {
            mockClient.mockGet("/chains", { total: 2, chains: [{ shortName: "ethereum" }, { shortName: "bitcoin" }] });
            const result = await mcpClient.callTool({ name: "getChains", arguments: { hasCex: true } });
            expect(mockClient.calls).toContainEqual(
                expect.objectContaining({ method: "GET", path: "/chains" }),
            );
            const content = JSON.parse((result.content as any)[0].text);
            expect(content.total).toBe(2);
        });
    });

    describe("getQuote", () => {
        it("calls GET /quotes with from, to, amount", async () => {
            mockClient.mockGet("/quotes", {
                quotes: [{ quoteId: "q1", provider: "changelly", rate: 20, estimatedAmount: 0.5 }],
            });
            const result = await mcpClient.callTool({
                name: "getQuote",
                arguments: { from: "tokenA", to: "tokenB", amount: 1 },
            });
            const call = mockClient.calls.find((c) => c.path === "/quotes");
            expect(call?.data).toMatchObject({ from: "tokenA", to: "tokenB", amount: 1 });
            const content = JSON.parse((result.content as any)[0].text);
            expect(content.quotes[0].quoteId).toBe("q1");
        });
    });

    describe("createExchange", () => {
        it("calls POST /exchanges with body", async () => {
            mockClient.mockPost("/exchanges", {
                houdiniId: "HOUDINI123",
                status: "waiting",
                addressFrom: "bc1q...",
            });
            const result = await mcpClient.callTool({
                name: "createExchange",
                arguments: { quoteId: "q1", addressTo: "0xabc" },
            });
            const call = mockClient.calls.find((c) => c.path === "/exchanges");
            expect(call?.method).toBe("POST");
            expect(call?.data).toMatchObject({ quoteId: "q1", addressTo: "0xabc" });
            const content = JSON.parse((result.content as any)[0].text);
            expect(content.houdiniId).toBe("HOUDINI123");
        });
    });

    describe("getOrder", () => {
        it("calls GET /orders/{houdiniId}", async () => {
            mockClient.mockGet("/orders/", { houdiniId: "H1", status: "completed" });
            const result = await mcpClient.callTool({
                name: "getOrder",
                arguments: { houdiniId: "H1" },
            });
            const call = mockClient.calls.find((c) => c.path === "/orders/H1");
            expect(call).toBeDefined();
            const content = JSON.parse((result.content as any)[0].text);
            expect(content.status).toBe("completed");
        });
    });

    describe("getOrders", () => {
        it("calls GET /orders with pagination", async () => {
            mockClient.mockGet("/orders", { orders: [], totalPages: 0 });
            await mcpClient.callTool({
                name: "getOrders",
                arguments: { page: 1, pageSize: 10 },
            });
            const call = mockClient.calls.find((c) => c.path === "/orders" && !c.path.includes("/orders/"));
            expect(call?.data).toMatchObject({ page: 1, pageSize: 10 });
        });
    });

    describe("getSwapProviders", () => {
        it("calls GET /swaps with no params", async () => {
            mockClient.mockGet("/swaps", { swaps: [{ name: "Changelly", type: "cex" }] });
            const result = await mcpClient.callTool({ name: "getSwapProviders", arguments: {} });
            expect(mockClient.calls).toContainEqual(
                expect.objectContaining({ method: "GET", path: "/swaps" }),
            );
            const content = JSON.parse((result.content as any)[0].text);
            expect(content.swaps[0].name).toBe("Changelly");
        });
    });

    describe("getMinMax", () => {
        it("calls GET /minMax with from and to", async () => {
            mockClient.mockGet("/minMax", { cex: { min: 0.001, max: 10 } });
            const result = await mcpClient.callTool({
                name: "getMinMax",
                arguments: { tokenIdFrom: "tA", tokenIdTo: "tB" },
            });
            const call = mockClient.calls.find((c) => c.path === "/minMax");
            expect(call?.data).toMatchObject({ tokenIdFrom: "tA", tokenIdTo: "tB" });
            const content = JSON.parse((result.content as any)[0].text);
            expect(content.cex.min).toBe(0.001);
        });
    });

    describe("DEX tools", () => {
        it("dexApprove calls POST /dex/approve", async () => {
            mockClient.mockPost("/dex/approve", { txData: "0x..." });
            await mcpClient.callTool({
                name: "dexApprove",
                arguments: { quoteId: "q1", address: "0xabc" },
            });
            const call = mockClient.calls.find((c) => c.path === "/dex/approve");
            expect(call?.method).toBe("POST");
        });

        it("dexCheckAllowance calls POST /dex/allowance", async () => {
            mockClient.mockPost("/dex/allowance", { sufficient: true });
            await mcpClient.callTool({
                name: "dexCheckAllowance",
                arguments: { quoteId: "q1", address: "0xabc" },
            });
            expect(mockClient.calls).toContainEqual(
                expect.objectContaining({ method: "POST", path: "/dex/allowance" }),
            );
        });

        it("dexConfirmTx calls POST /dex/confirmTx", async () => {
            mockClient.mockPost("/dex/confirmTx", { confirmed: true });
            await mcpClient.callTool({
                name: "dexConfirmTx",
                arguments: { quoteId: "q1", txHash: "0xdeadbeef" },
            });
            expect(mockClient.calls).toContainEqual(
                expect.objectContaining({ method: "POST", path: "/dex/confirmTx" }),
            );
        });

        it("dexChainSignatures calls POST /dex/chainSignatures", async () => {
            mockClient.mockPost("/dex/chainSignatures", { isComplete: false, data: {} });
            await mcpClient.callTool({
                name: "dexChainSignatures",
                arguments: { quoteId: "q1" },
            });
            expect(mockClient.calls).toContainEqual(
                expect.objectContaining({ method: "POST", path: "/dex/chainSignatures" }),
            );
        });
    });

    describe("swap (composite)", () => {
        it("executes full flow: tokens → minMax → quotes → exchanges", async () => {
            mockClient.mockGet("/tokens", {
                total: 1,
                tokens: [{ id: "btc-id", symbol: "BTC", chain: "bitcoin" }],
            });
            mockClient.mockGet("/minMax", { cex: { min: 0.001, max: 100 } });
            mockClient.mockGet("/quotes", {
                quotes: [{ quoteId: "q99", provider: "exolix", rate: 20, estimatedAmount: 2 }],
            });
            mockClient.mockPost("/exchanges", {
                houdiniId: "HOUDINI999",
                status: "waiting",
                addressFrom: "bc1qdeposit...",
            });

            const result = await mcpClient.callTool({
                name: "swap",
                arguments: {
                    fromSymbol: "BTC",
                    fromChain: "bitcoin",
                    toSymbol: "ETH",
                    toChain: "ethereum",
                    amount: 0.1,
                    addressTo: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
                },
            });

            // Should have called: 2x getTokens, 1x getMinMax, 1x getQuotes, 1x POST exchanges
            const getCalls = mockClient.calls.filter((c) => c.method === "GET");
            const postCalls = mockClient.calls.filter((c) => c.method === "POST");

            expect(getCalls.filter((c) => c.path === "/tokens")).toHaveLength(2);
            expect(getCalls.filter((c) => c.path === "/minMax")).toHaveLength(1);
            expect(getCalls.filter((c) => c.path === "/quotes")).toHaveLength(1);
            expect(postCalls.filter((c) => c.path === "/exchanges")).toHaveLength(1);

            const content = JSON.parse((result.content as any)[0].text);
            expect(content.success).toBe(true);
            expect(content.order.houdiniId).toBe("HOUDINI999");
            expect(content.order.depositAddress).toBe("bc1qdeposit...");
        });

        it("returns error when source token not found", async () => {
            mockClient.mockGet("/tokens", { total: 0, tokens: [] });

            const result = await mcpClient.callTool({
                name: "swap",
                arguments: {
                    fromSymbol: "FAKE",
                    fromChain: "nowhere",
                    toSymbol: "ETH",
                    toChain: "ethereum",
                    amount: 1,
                    addressTo: "0xabc",
                },
            });

            const content = JSON.parse((result.content as any)[0].text);
            expect(content.error).toContain("FAKE");
            expect(result.isError).toBe(true);
        });

        it("returns error when amount is below minimum", async () => {
            mockClient.mockGet("/tokens", {
                total: 1,
                tokens: [{ id: "t1", symbol: "BTC", chain: "bitcoin" }],
            });
            mockClient.mockGet("/minMax", { cex: { min: 0.01, max: 10 } });

            const result = await mcpClient.callTool({
                name: "swap",
                arguments: {
                    fromSymbol: "BTC",
                    fromChain: "bitcoin",
                    toSymbol: "ETH",
                    toChain: "ethereum",
                    amount: 0.001,
                    addressTo: "0xabc",
                },
            });

            const content = JSON.parse((result.content as any)[0].text);
            expect(content.error).toContain("below minimum");
            expect(result.isError).toBe(true);
        });

        it("returns error when no quotes available", async () => {
            mockClient.mockGet("/tokens", {
                total: 1,
                tokens: [{ id: "t1", symbol: "BTC", chain: "bitcoin" }],
            });
            mockClient.mockGet("/minMax", { cex: { min: 0.001, max: 100 } });
            mockClient.mockGet("/quotes", { quotes: [] });

            const result = await mcpClient.callTool({
                name: "swap",
                arguments: {
                    fromSymbol: "BTC",
                    fromChain: "bitcoin",
                    toSymbol: "ETH",
                    toChain: "ethereum",
                    amount: 0.1,
                    addressTo: "0xabc",
                },
            });

            const content = JSON.parse((result.content as any)[0].text);
            expect(content.error).toContain("No quotes");
            expect(result.isError).toBe(true);
        });
    });

    describe("resources", () => {
        it("returns pricing info", async () => {
            const result = await mcpClient.readResource({ uri: "houdiniswap://pricing" });
            const text = (result.contents[0] as any).text as string;
            expect(text).toContain("$0.0001");
            expect(text).toContain("$0.001");
            expect(text).toContain("$0.01");
            expect(text).toContain("60 requests/minute");
        });

        it("returns openapi spec", async () => {
            const result = await mcpClient.readResource({ uri: "houdiniswap://openapi" });
            const text = (result.contents[0] as any).text as string;
            expect(text).toContain("openapi");
        });
    });
});
