import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HoudiniClient, ChainResult } from "@houdiniswap/agent-shared";
import { z } from "zod";
import { asToolResult, compactChainResult } from "../shape.js";

export const registerChainTools = (server: McpServer, client: HoudiniClient) => {
    server.tool(
        "getChains",
        "List supported blockchains on HoudiniSwap (id, name, shortName, kind, chainId, memo requirement). Pass verbose for explorer URL templates, icons and address-validation patterns.",
        {
            hasCex: z.boolean().optional().describe("Only chains with CEX support"),
            hasDex: z.boolean().optional().describe("Only chains with DEX support"),
            kind: z.string().optional().describe("Chain kind filter"),
            name: z.string().optional().describe("Search by chain name"),
            page: z.number().int().min(1).default(1).optional(),
            pageSize: z.number().int().min(1).max(100).default(100).optional(),
            verbose: z.boolean().optional().describe("Return the full unfiltered API response"),
        },
        async ({ verbose, ...params }) => {
            const result = await client.get<ChainResult>("/chains", params);
            return asToolResult(verbose ? result : compactChainResult(result));
        },
    );
};
