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

    /**
     * These assert the whole body with toEqual, not method and path alone.
     *
     * What they do NOT do is catch a schema rename. Every tool forwards its
     * args straight to client.post, and execute() bypasses inputSchema (the AI
     * SDK validates only on the model-call path), so a test that hands in
     * `addressFrom` proves only that `addressFrom` survives the trip. Renaming
     * the schema to `address` leaves these green — parity.test.ts is what
     * guards the names, by asserting the schema shape itself.
     *
     * What they do catch is the tool mangling the body between args and wire:
     * a dropped field, a silently added one, a value rewritten in passing. The
     * old dexApprove test caught neither, since it passed `address` — the very
     * parameter that 422'd every DEX call — and asserted only method and path.
     */
    describe("dexApprove", () => {
        it("posts addressFrom, not address", async () => {
            mockClient.mockPost("/dex/approve", { approvals: [], signatures: [] });
            await tools.dexApprove.execute(
                { quoteId: "q1", addressFrom: "0xabc" },
                { toolCallId: "t1", messages: [] },
            );
            expect(mockClient.calls[0]).toMatchObject({ method: "POST", path: "/dex/approve" });
            expect(mockClient.calls[0].data).toEqual({ quoteId: "q1", addressFrom: "0xabc" });
        });
    });

    describe("dexCheckAllowance", () => {
        it("posts addressFrom, not address", async () => {
            mockClient.mockPost("/dex/allowance", true);
            await tools.dexCheckAllowance.execute(
                { quoteId: "q1", addressFrom: "0xabc" },
                { toolCallId: "t1", messages: [] },
            );
            expect(mockClient.calls[0]).toMatchObject({ method: "POST", path: "/dex/allowance" });
            expect(mockClient.calls[0].data).toEqual({ quoteId: "q1", addressFrom: "0xabc" });
        });
    });

    describe("dexConfirmTx", () => {
        it("posts the order id, not a quoteId", async () => {
            mockClient.mockPost("/dex/confirmTx", true);
            await tools.dexConfirmTx.execute(
                { id: "H1", txHash: `0x${"a".repeat(64)}` },
                { toolCallId: "t1", messages: [] },
            );
            expect(mockClient.calls[0]).toMatchObject({ method: "POST", path: "/dex/confirmTx" });
            expect(mockClient.calls[0].data).toEqual({ id: "H1", txHash: `0x${"a".repeat(64)}` });
        });
    });

    describe("dexChainSignatures", () => {
        it("posts the whole signature chain", async () => {
            mockClient.mockPost("/dex/chainSignatures", { signatures: [] });
            const args = {
                quoteId: "q1",
                addressFrom: "0xabc",
                previousSignature: "0xsig",
                signatureKey: "k1",
                signatureStep: 1,
            };
            await tools.dexChainSignatures.execute(args, { toolCallId: "t1", messages: [] });
            expect(mockClient.calls[0]).toMatchObject({ method: "POST", path: "/dex/chainSignatures" });
            expect(mockClient.calls[0].data).toEqual(args);
        });
    });

    describe("getOrders", () => {
        // dateFrom/dateTo silently disabled this filter; the API takes from/to.
        it("sends the API's from/to date range", async () => {
            mockClient.mockGet("/orders", { orders: [], total: 0 });
            await tools.getOrders.execute(
                { from: "2026-08-01T00:00:00.000Z", to: "2026-08-07T00:00:00.000Z", status: 4 },
                { toolCallId: "t1", messages: [] },
            );
            expect(mockClient.calls[0].path).toBe("/orders");
            expect(mockClient.calls[0].data).toMatchObject({
                from: "2026-08-01T00:00:00.000Z",
                to: "2026-08-07T00:00:00.000Z",
                status: 4,
            });
            expect(mockClient.calls[0].data).not.toHaveProperty("dateFrom");
            expect(mockClient.calls[0].data).not.toHaveProperty("dateTo");
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
                quotes: [{ quoteId: "q99", swapName: "Exolix", type: "standard", amountOut: 2 }],
            });
            mockClient.mockPost("/exchanges", {
                houdiniId: "HOUDINI999",
                status: 0,
                depositAddress: "bc1qdeposit...",
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
            expect((result as any).error).toContain("No CEX quotes");
        });
    });
});
