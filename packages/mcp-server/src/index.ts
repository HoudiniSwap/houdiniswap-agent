#!/usr/bin/env node
import { createMcpServer } from "./server.js";
import { HoudiniClient } from "@houdiniswap/agent-shared";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getAuthConfig } from "./auth.js";

const main = async () => {
    const baseUrl = process.env.HOUDINI_API_URL;
    const transport = process.argv.includes("--transport=http") ? "http" : "stdio";
    const port = parseInt(process.env.PORT || "8080", 10);

    const client = new HoudiniClient({
        baseUrl,
        auth: getAuthConfig(),
    });

    const server = createMcpServer(client);

    if (transport === "http") {
        const express = await import("express");
        const { StreamableHTTPServerTransport } = await import(
            "@modelcontextprotocol/sdk/server/streamableHttp.js"
        );

        const app = express.default();
        app.use(express.json());

        const httpTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await server.connect(httpTransport);

        app.all("/mcp", async (req, res) => {
            // `req.body` must be passed through: express.json() above has already
            // consumed the request stream, so without it the transport re-reads a
            // drained stream and answers every request with "Parse error: Invalid
            // JSON" — which is what it did.
            await httpTransport.handleRequest(req, res, req.body);
        });

        app.listen(port, () => {
            console.error(`HoudiniSwap MCP server (HTTP) listening on port ${port}`);
        });
    } else {
        const stdioTransport = new StdioServerTransport();
        await server.connect(stdioTransport);
        console.error("HoudiniSwap MCP server (stdio) ready");
    }
};

main().catch((err) => {
    console.error("Failed to start MCP server:", err);
    process.exit(1);
});
