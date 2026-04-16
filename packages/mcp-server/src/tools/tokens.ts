import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HoudiniClient, TokenResult } from "@houdiniswap/agent-shared";
import { z } from "zod";

export const registerTokenTools = (server: McpServer, client: HoudiniClient) => {
    server.tool(
        "getTokens",
        "Search HoudiniSwap tokens by symbol, chain, or address. Returns paginated results with token IDs needed for quotes and exchanges.",
        {
            symbol: z.string().optional().describe("Exact symbol match (e.g. 'BTC', 'ETH', 'USDC')"),
            chain: z.string().optional().describe("Filter by chain shortName (e.g. 'ethereum', 'bitcoin', 'solana')"),
            term: z.string().optional().describe("Search term (name, symbol, or address)"),
            address: z.string().optional().describe("Filter by contract address"),
            hasCex: z.boolean().optional().describe("Only tokens available on CEX providers"),
            hasDex: z.boolean().optional().describe("Only tokens available on DEX providers"),
            mainnet: z.boolean().optional().describe("Only native/mainnet tokens"),
            page: z.number().int().min(1).default(1).optional().describe("Page number"),
            pageSize: z.number().int().min(1).max(100).default(20).optional().describe("Results per page"),
        },
        async (params) => {
            const result = await client.get<TokenResult>("/tokens", params);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                }],
            };
        },
    );
};
