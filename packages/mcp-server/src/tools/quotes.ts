import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HoudiniClient, QuoteResult } from "@houdiniswap/agent-shared";
import { z } from "zod";

export const registerQuoteTools = (server: McpServer, client: HoudiniClient) => {
    server.tool(
        "getQuote",
        "Get swap quotes for a token pair and amount. Returns quotes from multiple CEX and DEX providers, sorted by best rate. Use token IDs from getTokens.",
        {
            from: z.string().describe("Source token ID (from getTokens)"),
            to: z.string().describe("Destination token ID (from getTokens)"),
            amount: z.number().positive().describe("Amount to swap in source token units"),
            types: z.array(z.enum(["standard", "private", "dex"])).optional().describe("Quote types to include (default: all)"),
            slippage: z.number().min(0).max(50).optional().describe("Max slippage percentage for DEX quotes"),
            senderAddress: z.string().optional().describe("Sender wallet address (required for DEX)"),
            receiverAddress: z.string().optional().describe("Receiver wallet address"),
            sort: z.enum(["amountOut", "amountOutUsd", "duration"]).optional().describe("Sort quotes by"),
            sortOrder: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
        },
        async (params) => {
            const result = await client.get<QuoteResult>("/quotes", params);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        },
    );
};
