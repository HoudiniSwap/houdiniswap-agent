import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HoudiniClient, SwapProvider } from "@houdiniswap/agent-shared";

export const registerSwapProviderTools = (server: McpServer, client: HoudiniClient) => {
    server.tool(
        "getSwapProviders",
        "List all available swap providers (CEX and DEX) on HoudiniSwap with their capabilities.",
        {},
        async () => {
            const result = await client.get<{ swaps: SwapProvider[] }>("/swaps");
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        },
    );
};
