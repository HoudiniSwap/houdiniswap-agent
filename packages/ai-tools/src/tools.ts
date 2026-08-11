import { tool } from "ai";
import { z } from "zod";
import type {
    HoudiniClient,
    TokenResult,
    ChainResult,
    QuoteResult,
    Order,
    MinMaxResult,
    SwapProvider,
} from "@houdiniswap/agent-shared";
import {
    tokensSchema,
    chainsSchema,
    quoteSchema,
    exchangeSchema,
    orderSchema,
    ordersSchema,
    minMaxSchema,
    dexApproveSchema,
    dexAllowanceSchema,
    dexConfirmTxSchema,
    dexChainSignaturesSchema,
    swapSchema,
} from "./schemas.js";

export const createTools = (client: HoudiniClient) => ({
    getTokens: tool({
        description:
            "Search HoudiniSwap tokens by symbol, chain, or address. Returns paginated results with token IDs needed for quotes and exchanges.",
        inputSchema: tokensSchema,
        execute: async (params) => client.get<TokenResult>("/tokens", params),
    }),

    getChains: tool({
        description:
            "List supported blockchains on HoudiniSwap with metadata (explorer URLs, memo requirements, CEX/DEX availability).",
        inputSchema: chainsSchema,
        execute: async (params) => client.get<ChainResult>("/chains", params),
    }),

    getQuote: tool({
        description:
            "Get swap quotes for a token pair and amount. Returns quotes from multiple CEX and DEX providers sorted by best rate. Use token IDs from getTokens.",
        inputSchema: quoteSchema,
        execute: async (params) => client.get<QuoteResult>("/quotes", params),
    }),

    createExchange: tool({
        description:
            "Create a swap order using a quoteId from getQuote. Returns the order with a deposit address (CEX) or transaction data (DEX).",
        inputSchema: exchangeSchema,
        execute: async (params) => client.post<Order>("/exchanges", params),
    }),

    getOrder: tool({
        description: "Get the current status and details of a swap order by its Houdini ID.",
        inputSchema: orderSchema,
        // Encoded: an unescaped id of "../chains" reaches a different endpoint.
        execute: async ({ houdiniId }) => client.get<Order>(`/orders/${encodeURIComponent(houdiniId)}`),
    }),

    getOrders: tool({
        description: "List swap orders with optional filters. Works with API-key or x402 authentication.",
        inputSchema: ordersSchema,
        execute: async (params) =>
            client.get<{ orders: Order[]; totalPages: number }>("/orders", params),
    }),

    getSwapProviders: tool({
        description: "List all available swap providers (CEX and DEX) on HoudiniSwap.",
        inputSchema: z.object({}),
        execute: async () => client.get<SwapProvider[]>("/swaps"),
    }),

    getMinMax: tool({
        description:
            "Get minimum and maximum swap amounts for a token pair across CEX, DEX, and private swap routes.",
        inputSchema: minMaxSchema,
        execute: async (params) => client.get<MinMaxResult>("/minMax", params),
    }),

    dexApprove: tool({
        description:
            "Get token approval transaction data for a DEX swap. Returns the transaction(s) or permit signature data needed before executing.",
        inputSchema: dexApproveSchema,
        execute: async (params) => client.post("/dex/approve", params),
    }),

    dexCheckAllowance: tool({
        description: "Check if a token allowance is sufficient for a DEX swap.",
        inputSchema: dexAllowanceSchema,
        execute: async (params) => client.post("/dex/allowance", params),
    }),

    dexConfirmTx: tool({
        description: "Confirm a DEX transaction after the user has signed and submitted it on-chain.",
        inputSchema: dexConfirmTxSchema,
        execute: async (params) => client.post("/dex/confirmTx", params),
    }),

    dexChainSignatures: tool({
        description:
            "Get the next signature in a multi-step DEX chain (e.g. permit + bridge). Call repeatedly until isComplete is true.",
        inputSchema: dexChainSignaturesSchema,
        execute: async (params) => client.post("/dex/chainSignatures", params),
    }),

    swap: tool({
        description:
            "Execute a complete swap: find tokens by symbol, validate amount, get the best quote, and create the exchange order. Returns the order with deposit address. CEX swaps only.",
        inputSchema: swapSchema,
        execute: async ({ fromSymbol, fromChain, toSymbol, toChain, amount, addressTo }) => {
            // Step 1: Find source and destination tokens in parallel
            const [fromTokens, toTokens] = await Promise.all([
                client.get<TokenResult>("/tokens", { symbol: fromSymbol, chain: fromChain, hasCex: true, pageSize: 5 }),
                client.get<TokenResult>("/tokens", { symbol: toSymbol, chain: toChain, hasCex: true, pageSize: 5 }),
            ]);

            const fromToken = fromTokens.tokens.find(t => t.mainnet) ?? fromTokens.tokens[0];
            if (!fromToken) return { error: `Token ${fromSymbol} not found on ${fromChain}` };

            const toToken = toTokens.tokens.find(t => t.mainnet) ?? toTokens.tokens[0];
            if (!toToken) return { error: `Token ${toSymbol} not found on ${toChain}` };

            // Step 2: Check min/max
            const minMax = await client.get<MinMaxResult>("/minMax", {
                tokenIdFrom: fromToken.id,
                tokenIdTo: toToken.id,
            });
            if (minMax.cex) {
                if (amount < minMax.cex.min)
                    return { error: `Amount ${amount} below minimum ${minMax.cex.min}` };
                if (minMax.cex.max > 0 && amount > minMax.cex.max)
                    return { error: `Amount ${amount} exceeds maximum ${minMax.cex.max}` };
            }

            // Step 3: Get best quote
            const quoteResult = await client.get<QuoteResult>("/quotes", {
                from: fromToken.id,
                to: toToken.id,
                amount,
            });
            // Filter to CEX quotes only — DEX swaps require addressFrom and on-chain signing
            const cexQuotes = quoteResult.quotes?.filter(q => q.type !== "dex" && q.amountOut) ?? [];
            if (!cexQuotes.length) return { error: "No CEX quotes available for this pair" };
            const bestQuote = cexQuotes[0];

            // Step 4: Create exchange
            const order = await client.post<Order>("/exchanges", {
                quoteId: bestQuote.quoteId,
                addressTo,
            });

            const depositAddress = order.depositAddress;
            if (!depositAddress) return { error: "Exchange created but deposit address not returned" };

            return {
                success: true,
                order: {
                    houdiniId: order.houdiniId,
                    status: order.status,
                    depositAddress,
                    estimatedOutput: bestQuote.amountOut,
                    provider: bestQuote.swapName,
                },
                instructions: `Send ${amount} ${fromSymbol} to ${depositAddress} to complete the swap.`,
            };
        },
    }),
});
