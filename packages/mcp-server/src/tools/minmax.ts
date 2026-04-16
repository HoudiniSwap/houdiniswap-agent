import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HoudiniClient, MinMaxResult } from "@houdiniswap/agent-shared";
import { z } from "zod";

export const registerMinMaxTools = (server: McpServer, client: HoudiniClient) => {
    server.tool(
        "getMinMax",
        "Get minimum and maximum swap amounts for a token pair across CEX, DEX, and private swap routes.",
        {
            tokenIdFrom: z.string().describe("Source token ID (from getTokens)"),
            tokenIdTo: z.string().describe("Destination token ID (from getTokens)"),
        },
        async (params) => {
            const result = await client.get<MinMaxResult>("/minMax", params);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        },
    );
};
