import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HoudiniClient, Order } from "@houdiniswap/agent-shared";
import { z } from "zod";

export const registerExchangeTools = (server: McpServer, client: HoudiniClient) => {
    server.tool(
        "createExchange",
        "Create a swap order using a quoteId from getQuote. Returns the order with a deposit address (for CEX) or transaction data (for DEX).",
        {
            quoteId: z.string().describe("Quote ID from getQuote response"),
            addressTo: z.string().describe("Destination wallet address for receiving funds"),
            addressFrom: z.string().optional().describe("Source wallet address (required for DEX swaps)"),
            destinationTag: z.string().optional().describe("Destination tag/memo (for XRP, XLM, etc.)"),
        },
        async (params) => {
            const result = await client.post<Order>("/exchanges", params);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        },
    );
};
