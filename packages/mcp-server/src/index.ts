#!/usr/bin/env node
import { createMcpServer } from "./server.js";
import { HoudiniClient } from "@houdiniswap/agent-shared";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const getAuthConfig = () => {
    const apiKey = process.env.HOUDINI_API_KEY;
    const x402Key = process.env.HOUDINI_X402_PRIVATE_KEY;
    const partnerId = process.env.HOUDINI_PARTNER_ID;

    if (apiKey) return { type: "apiKey" as const, key: apiKey };
    if (x402Key) return { type: "x402" as const, privateKey: x402Key as `0x${string}` };
    if (partnerId) return { type: "partnerId" as const, id: partnerId };
    return { type: "none" as const };
};

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
            await httpTransport.handleRequest(req, res);
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
