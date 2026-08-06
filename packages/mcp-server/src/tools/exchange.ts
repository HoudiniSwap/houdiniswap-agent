import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HoudiniClient, Order } from "@houdiniswap/agent-shared";
import { z } from "zod";
import { asToolResult, compactOrder } from "../shape.js";

export const registerExchangeTools = (server: McpServer, client: HoudiniClient) => {
    server.tool(
        "createExchange",
        "Create a swap order using a quoteId from getQuote. Returns the order with a deposit address (for CEX) or transaction data (for DEX).",
        {
            quoteId: z.string().describe("Quote ID from getQuote response"),
            addressTo: z.string().describe("Destination wallet address for receiving funds"),
            addressFrom: z.string().optional().describe("Source wallet address (required for DEX swaps)"),
            destinationTag: z.string().optional().describe("Destination tag/memo (for XRP, XLM, etc.)"),
            // Without `signatures` the gasless permit path was unreachable:
            // dexApprove with usePermit returns EIP-2612 typed data and there was
            // nowhere to submit the resulting signature.
            signatures: z
                .array(
                    z.object({
                        signature: z.string(),
                        key: z.string(),
                        swapRequiredMetadata: z.record(z.unknown()).optional(),
                    }),
                )
                .optional()
                .describe("EIP-712 signatures from dexApprove's permit path (DEX only)"),
            refundAddress: z.string().optional().describe("Address to refund to if a fixed-rate swap fails"),
            refundExtraId: z.string().optional().describe("Memo/tag for the refund address, on chains that need one"),
            walletInfo: z.string().max(256).optional().describe("Free-text wallet identifier recorded on the order"),
            verbose: z.boolean().optional().describe("Return the full unfiltered API response"),
        },
        async ({ verbose, ...params }) => {
            const result = await client.post<Order>("/exchanges", params);
            return asToolResult(verbose ? result : compactOrder(result));
        },
    );
};
