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

        // A transport instance serves exactly one request: reusing a single
        // long-lived one answered the first request and then returned a bare
        // HTTP 500 for every request after it, with nothing logged. Stateless
        // mode wants a fresh server and transport per request, torn down when
        // the response closes.
        app.all("/mcp", async (req, res) => {
            const requestServer = createMcpServer(client);
            const requestTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
            res.on("close", () => {
                requestTransport.close().catch(() => {});
                requestServer.close().catch(() => {});
            });
            try {
                await requestServer.connect(requestTransport);
                // `req.body` must be passed through: express.json() has already
                // consumed the request stream, so without it the transport
                // re-reads a drained stream and answers "Parse error: Invalid
                // JSON" — which is what it did.
                await requestTransport.handleRequest(req, res, req.body);
            } catch (err) {
                // Otherwise express's default handler returns an empty 500 and
                // the cause is invisible.
                const message = err instanceof Error ? err.message : String(err);
                console.error(`MCP request failed: ${message}`);
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: "2.0",
                        error: { code: -32603, message: `Internal server error: ${message}` },
                        id: null,
                    });
                }
            }
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
