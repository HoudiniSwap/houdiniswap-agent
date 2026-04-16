import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HoudiniClient } from "@houdiniswap/agent-shared";
import { registerTokenTools } from "./tools/tokens.js";
import { registerChainTools } from "./tools/chains.js";
import { registerQuoteTools } from "./tools/quotes.js";
import { registerExchangeTools } from "./tools/exchange.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerSwapProviderTools } from "./tools/swaps.js";
import { registerMinMaxTools } from "./tools/minmax.js";
import { registerDexTools } from "./tools/dex.js";
import { registerSwapFlowTool } from "./tools/swap-flow.js";
import { registerResources } from "./resources/openapi.js";

export const createMcpServer = (client: HoudiniClient): McpServer => {
    const server = new McpServer({
        name: "houdiniswap",
        version: "0.1.0",
    });

    // Register all tools
    registerTokenTools(server, client);
    registerChainTools(server, client);
    registerQuoteTools(server, client);
    registerExchangeTools(server, client);
    registerOrderTools(server, client);
    registerSwapProviderTools(server, client);
    registerMinMaxTools(server, client);
    registerDexTools(server, client);
    registerSwapFlowTool(server, client);

    // Register resources
    registerResources(server, client);

    return server;
};
