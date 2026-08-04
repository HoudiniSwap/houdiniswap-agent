import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HoudiniClient, Order } from "@houdiniswap/agent-shared";
import { z } from "zod";
import { asToolResult, compactOrder, compactOrderList } from "../shape.js";

export const registerOrderTools = (server: McpServer, client: HoudiniClient) => {
    server.tool(
        "getOrder",
        "Get the current status and details of a swap order by its Houdini ID.",
        {
            houdiniId: z.string().describe("The Houdini order ID (e.g. 'HOUDINI...')"),
            verbose: z.boolean().optional().describe("Return the full unfiltered API response"),
        },
        async ({ houdiniId, verbose }) => {
            const result = await client.get<Order>(`/orders/${houdiniId}`);
            return asToolResult(verbose ? result : compactOrder(result));
        },
    );

    server.tool(
        "getOrders",
        "List swap orders with optional filters. Requires API key authentication.",
        {
            page: z.number().int().min(1).default(1).optional(),
            pageSize: z.number().int().min(1).max(100).default(20).optional(),
            status: z.number().optional().describe("Filter by order status code"),
            dateFrom: z.string().optional().describe("Start date (ISO 8601)"),
            dateTo: z.string().optional().describe("End date (ISO 8601)"),
            multiId: z.string().optional().describe("Filter by multi-order ID"),
            verbose: z.boolean().optional().describe("Return the full unfiltered API response"),
        },
        async ({ verbose, ...params }) => {
            const result = await client.get<{ orders: Order[]; totalPages: number }>("/orders", params);
            return asToolResult(verbose ? result : compactOrderList(result));
        },
    );
};
