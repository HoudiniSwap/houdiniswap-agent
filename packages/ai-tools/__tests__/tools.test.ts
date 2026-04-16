import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTools } from "../src/tools.js";
import type { HoudiniClient } from "@houdiniswap/agent-shared";

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

let mockClient: MockHoudiniClient;
let tools: ReturnType<typeof createTools>;

beforeEach(() => {
    mockClient = new MockHoudiniClient();
    tools = createTools(mockClient as unknown as HoudiniClient);
});

describe("AI SDK tools", () => {
    it("exports all 13 tools", () => {
        const toolNames = Object.keys(tools).sort();
        expect(toolNames).toEqual([
            "createExchange",
            "dexApprove",
            "dexChainSignatures",
            "dexCheckAllowance",
            "dexConfirmTx",
            "getChains",
            "getMinMax",
            "getOrder",
            "getOrders",
            "getQuote",
            "getSwapProviders",
            "getTokens",
            "swap",
        ]);
    });

    describe("getTokens", () => {
        it("calls GET /tokens and returns result", async () => {
            mockClient.mockGet("/tokens", { total: 1, tokens: [{ symbol: "BTC" }] });
            const result = await tools.getTokens.execute({ symbol: "BTC" }, { toolCallId: "t1", messages: [] });
            expect(mockClient.calls[0]).toMatchObject({ method: "GET", path: "/tokens" });
            expect(result).toEqual({ total: 1, tokens: [{ symbol: "BTC" }] });
        });
    });

    describe("getChains", () => {
        it("calls GET /chains", async () => {
            mockClient.mockGet("/chains", { total: 2, chains: [{ shortName: "ethereum" }] });
            const result = await tools.getChains.execute({ hasCex: true }, { toolCallId: "t1", messages: [] });
            expect(mockClient.calls[0].path).toBe("/chains");
            expect(result).toHaveProperty("total", 2);
        });
    });

    describe("getQuote", () => {
        it("calls GET /quotes with params", async () => {
            mockClient.mockGet("/quotes", { quotes: [{ quoteId: "q1", rate: 20 }] });
            const result = await tools.getQuote.execute(
                { from: "tokenA", to: "tokenB", amount: 1 },
                { toolCallId: "t1", messages: [] },
            );
            expect(mockClient.calls[0].data).toMatchObject({ from: "tokenA", to: "tokenB", amount: 1 });
            expect((result as any).quotes[0].quoteId).toBe("q1");
        });
    });

    describe("createExchange", () => {
        it("calls POST /exchanges", async () => {
            mockClient.mockPost("/exchanges", { houdiniId: "H123", status: "waiting" });
            const result = await tools.createExchange.execute(
                { quoteId: "q1", addressTo: "0xabc" },
                { toolCallId: "t1", messages: [] },
            );
            expect(mockClient.calls[0]).toMatchObject({ method: "POST", path: "/exchanges" });
            expect((result as any).houdiniId).toBe("H123");
        });
    });

    describe("getOrder", () => {
        it("calls GET /orders/{id}", async () => {
            mockClient.mockGet("/orders/", { houdiniId: "H1", status: "completed" });
            const result = await tools.getOrder.execute(
                { houdiniId: "H1" },
                { toolCallId: "t1", messages: [] },
            );
            expect(mockClient.calls[0].path).toBe("/orders/H1");
        });
    });

    describe("getSwapProviders", () => {
        it("calls GET /swaps", async () => {
            mockClient.mockGet("/swaps", [{ name: "Changelly" }]);
            const result = await tools.getSwapProviders.execute({}, { toolCallId: "t1", messages: [] });
            expect(mockClient.calls[0].path).toBe("/swaps");
        });
    });

    describe("getMinMax", () => {
        it("calls GET /minMax with tokenIdFrom/tokenIdTo", async () => {
            mockClient.mockGet("/minMax", { cex: { min: 0.001, max: 10 } });
            const result = await tools.getMinMax.execute(
                { tokenIdFrom: "tA", tokenIdTo: "tB" },
                { toolCallId: "t1", messages: [] },
            );
            expect(mockClient.calls[0].data).toMatchObject({ tokenIdFrom: "tA", tokenIdTo: "tB" });
        });
    });

    describe("dexApprove", () => {
        it("calls POST /dex/approve", async () => {
            mockClient.mockPost("/dex/approve", { txData: "0x..." });
            await tools.dexApprove.execute(
                { quoteId: "q1", address: "0xabc" },
                { toolCallId: "t1", messages: [] },
            );
            expect(mockClient.calls[0]).toMatchObject({ method: "POST", path: "/dex/approve" });
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

            const result = await tools.swap.execute(
                {
                    fromSymbol: "BTC",
                    fromChain: "bitcoin",
                    toSymbol: "ETH",
                    toChain: "ethereum",
                    amount: 0.1,
                    addressTo: "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18",
                },
                { toolCallId: "t1", messages: [] },
            );

            expect(mockClient.calls.filter((c) => c.path === "/tokens")).toHaveLength(2);
            expect(mockClient.calls.find((c) => c.path === "/minMax")).toBeDefined();
            expect(mockClient.calls.find((c) => c.path === "/quotes")).toBeDefined();
            expect(mockClient.calls.find((c) => c.path === "/exchanges")).toBeDefined();
            expect((result as any).success).toBe(true);
            expect((result as any).order.houdiniId).toBe("HOUDINI999");
        });

        it("returns error when token not found", async () => {
            mockClient.mockGet("/tokens", { total: 0, tokens: [] });
            const result = await tools.swap.execute(
                {
                    fromSymbol: "FAKE",
                    fromChain: "nowhere",
                    toSymbol: "ETH",
                    toChain: "ethereum",
                    amount: 1,
                    addressTo: "0xabc",
                },
                { toolCallId: "t1", messages: [] },
            );
            expect((result as any).error).toContain("FAKE");
        });

        it("returns error when no quotes", async () => {
            mockClient.mockGet("/tokens", {
                total: 1,
                tokens: [{ id: "t1", symbol: "BTC", chain: "bitcoin" }],
            });
            mockClient.mockGet("/minMax", { cex: { min: 0.001, max: 100 } });
            mockClient.mockGet("/quotes", { quotes: [] });
            const result = await tools.swap.execute(
                {
                    fromSymbol: "BTC",
                    fromChain: "bitcoin",
                    toSymbol: "ETH",
                    toChain: "ethereum",
                    amount: 0.1,
                    addressTo: "0xabc",
                },
                { toolCallId: "t1", messages: [] },
            );
            expect((result as any).error).toContain("No quotes");
        });
    });
});
