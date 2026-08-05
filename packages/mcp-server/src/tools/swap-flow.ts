import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HoudiniClient, TokenResult, Token, QuoteResult, Order, MinMaxResult } from "@houdiniswap/agent-shared";
import { z } from "zod";
import { asToolResult } from "../shape.js";

const pickToken = (tokens: Token[]): Token | undefined =>
    tokens.find(t => t.mainnet) ?? tokens[0];

export const registerSwapFlowTool = (server: McpServer, client: HoudiniClient) => {
    server.tool(
        "swap",
        "Execute a complete swap flow: find tokens by symbol, validate amount, get the best quote, and create the exchange order. Returns the order with deposit address. Use this for a simple end-to-end CEX swap.",
        {
            fromSymbol: z.string().describe("Source token symbol (e.g. 'BTC', 'ETH')"),
            fromChain: z.string().describe("Source chain (e.g. 'bitcoin', 'ethereum')"),
            toSymbol: z.string().describe("Destination token symbol (e.g. 'ETH', 'USDT')"),
            toChain: z.string().describe("Destination chain (e.g. 'ethereum', 'tron')"),
            amount: z.number().positive().describe("Amount to swap in source token units"),
            addressTo: z.string().describe("Destination wallet address"),
        },
        async ({ fromSymbol, fromChain, toSymbol, toChain, amount, addressTo }) => {
            try {
                // Step 1: Find source and destination tokens in parallel
                const [fromTokens, toTokens] = await Promise.all([
                    client.get<TokenResult>("/tokens", { symbol: fromSymbol, chain: fromChain, hasCex: true, pageSize: 5 }),
                    client.get<TokenResult>("/tokens", { symbol: toSymbol, chain: toChain, hasCex: true, pageSize: 5 }),
                ]);

                // Prefer mainnet tokens (cexTokenId matches symbol) over chain-specific variants
                const fromToken = pickToken(fromTokens.tokens);
                if (!fromToken) {
                    return {
                        content: [{ type: "text", text: JSON.stringify({ error: `Token ${fromSymbol} not found on ${fromChain}` }) }],
                        isError: true,
                    };
                }

                const toToken = pickToken(toTokens.tokens);
                if (!toToken) {
                    return {
                        content: [{ type: "text", text: JSON.stringify({ error: `Token ${toSymbol} not found on ${toChain}` }) }],
                        isError: true,
                    };
                }

                // Step 2: Check min/max
                const minMax = await client.get<MinMaxResult>("/minMax", {
                    tokenIdFrom: fromToken.id,
                    tokenIdTo: toToken.id,
                });

                if (minMax.cex) {
                    if (amount < minMax.cex.min) {
                        return {
                            content: [{ type: "text", text: JSON.stringify({ error: `Amount ${amount} is below minimum ${minMax.cex.min} for ${fromSymbol}` }) }],
                            isError: true,
                        };
                    }
                    if (minMax.cex.max > 0 && amount > minMax.cex.max) {
                        return {
                            content: [{ type: "text", text: JSON.stringify({ error: `Amount ${amount} exceeds maximum ${minMax.cex.max} for ${fromSymbol}` }) }],
                            isError: true,
                        };
                    }
                }

                // Step 3: Get best quote
                const quoteResult = await client.get<QuoteResult>("/quotes", {
                    from: fromToken.id,
                    to: toToken.id,
                    amount,
                });

                // Filter to CEX quotes only — DEX swaps require addressFrom and on-chain signing
                const cexQuotes = quoteResult.quotes?.filter(q => q.type !== "dex" && q.amountOut) ?? [];
                if (!cexQuotes.length) {
                    return {
                        content: [{ type: "text", text: JSON.stringify({ error: "No CEX quotes available for this pair and amount" }) }],
                        isError: true,
                    };
                }

                const bestQuote = cexQuotes[0];

                // Step 4: Create exchange
                const order = await client.post<Order>("/exchanges", {
                    quoteId: bestQuote.quoteId,
                    addressTo,
                });

                const depositAddress = order.depositAddress;
                if (!depositAddress) {
                    return {
                        content: [{ type: "text", text: JSON.stringify({ error: "Exchange created but deposit address not returned" }) }],
                        isError: true,
                    };
                }

                return asToolResult({
                    success: true,
                    order: {
                        houdiniId: order.houdiniId,
                        status: order.status,
                        depositAddress,
                        estimatedOutput: bestQuote.amountOut,
                        provider: bestQuote.swapName,
                    },
                    instructions: `Send ${amount} ${fromSymbol} to ${depositAddress} to complete the swap.`,
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : "Unknown error";
                return {
                    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
                    isError: true,
                };
            }
        },
    );
};
