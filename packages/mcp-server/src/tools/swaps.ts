import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HoudiniClient, SwapProvider } from "@houdiniswap/agent-shared";
import { z } from "zod";
import { asToolResult, compactProviderResult } from "../shape.js";

export const registerSwapProviderTools = (server: McpServer, client: HoudiniClient) => {
    server.tool(
        "getSwapProviders",
        "List all available swap providers (CEX and DEX) on HoudiniSwap. Returns each provider's shortName, which is what the getQuote `swaps` filter takes.",
        {
            isDex: z.boolean().optional().describe("Only DEX providers (true) or only CEX providers (false)"),
            markupSupported: z.boolean().optional().describe("Only providers that support partner markup"),
            slippageSupported: z.boolean().optional().describe("Only providers that accept a slippage parameter"),
            verbose: z.boolean().optional().describe("Return the full unfiltered API response"),
        },
        async ({ verbose, ...params }) => {
            const result = await client.get<SwapProvider[]>("/swaps", params);
            return asToolResult(verbose ? result : compactProviderResult(result));
        },
    );
};
