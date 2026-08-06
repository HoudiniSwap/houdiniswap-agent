import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HoudiniClient, TokenResult } from "@houdiniswap/agent-shared";
import { z } from "zod";
import { asToolResult, compactTokenResult } from "../shape.js";

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
            // The API defaults this to false, so unverified tokens are hidden
            // unless asked for. Without the parameter the skill's scam-token
            // warning could never fire, because no such token was reachable.
            unverified: z.boolean().optional().describe("Include unverified tokens (excluded by default). Warn the user before swapping any token with unverified: true."),
            hasSelfPrivate: z.boolean().optional().describe("Only tokens supporting private (anonymous 2-hop) swaps"),
            page: z.number().int().min(1).default(1).optional().describe("Page number"),
            pageSize: z.number().int().min(1).max(100).default(20).optional().describe("Results per page"),
            verbose: z.boolean().optional().describe("Return the full unfiltered API response"),
        },
        async ({ verbose, ...params }) => {
            const result = await client.get<TokenResult>("/tokens", params);
            return asToolResult(verbose ? result : compactTokenResult(result));
        },
    );
};
