import { createRequire } from "node:module";
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
import { registerSigningTools } from "./tools/sign.js";
import type { SigningServer } from "./signing/server.js";
import { registerResources } from "./resources/openapi.js";

// Read from package.json rather than hardcoding: this is the version MCP clients
// display, and it had been stuck at 0.1.0 across every release since.
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

export interface McpServerOptions {
    /** Shared across requests by the HTTP transport; see registerSigningTools. */
    signer?: SigningServer;
    /**
     * Off when the listener is not on loopback. The signing page is safe
     * because only the person at that machine can reach it; served from a host
     * the user does not control, that stops being true.
     */
    signing?: boolean;
}

export const createMcpServer = (client: HoudiniClient, options: McpServerOptions = {}): McpServer => {
    const server = new McpServer({
        name: "houdiniswap",
        version,
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
    if (options.signing !== false) registerSigningTools(server, client, options.signer);

    // Register resources
    registerResources(server, client);

    return server;
};
