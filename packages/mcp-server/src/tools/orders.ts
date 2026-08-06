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
        // Names mirror the API's query parameters exactly. The date filter used
        // to be sent as `dateFrom`/`dateTo`, which the API does not accept — it
        // takes `from`/`to` — so it was silently ignored and a request for
        // January 2020 returned today's orders.
        {
            page: z.number().int().min(1).optional().default(1),
            pageSize: z.number().int().min(1).max(100).optional().default(20),
            status: z.number().optional().describe("Filter by order status code (4 = FINISHED, 5 = EXPIRED)"),
            from: z.string().optional().describe("Start date, ISO 8601 (e.g. '2026-08-01T00:00:00.000Z')"),
            to: z.string().optional().describe("End date, ISO 8601"),
            multiId: z.string().optional().describe("Filter by multi-order ID"),
            anonymous: z.boolean().optional().describe("Only anonymous (private 2-hop) orders"),
            inTokenId: z.string().optional().describe("Filter by source token ID"),
            outTokenId: z.string().optional().describe("Filter by destination token ID"),
            sortBy: z.enum(["created", "updated", "amount"]).optional().describe("Sort field (default: created)"),
            sortOrder: z.enum(["asc", "desc"]).optional().describe("Sort direction (default: desc)"),
            verbose: z.boolean().optional().describe("Return the full unfiltered API response"),
        },
        async ({ verbose, ...params }) => {
            const result = await client.get<{ orders: Order[]; totalPages: number }>("/orders", params);
            return asToolResult(verbose ? result : compactOrderList(result));
        },
    );
};
