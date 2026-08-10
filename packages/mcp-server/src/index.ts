#!/usr/bin/env node
import { createMcpServer } from "./server.js";
import { SigningServer } from "./signing/server.js";
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
        // GET opens a standalone notification stream the SDK never closes, and
        // the per-request server stays pinned for as long as the client holds
        // the socket. 181 idle GETs were enough to OOM the process — no
        // credentials required. Nothing here needs that stream, so it is refused.
        app.get("/mcp", (_req, res) => {
            res.status(405)
                .set("Allow", "POST")
                .json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32601,
                        message: "This server is request/response only; use POST. GET would open a notification stream it does not use.",
                    },
                    id: null,
                });
        });

        // One signer for the process. A fresh McpServer is built per request
        // (a shared one served exactly one request), so a signer created inside
        // it would be thrown away with it and the token from dexSignRequest
        // would be unknown to the dexSignStatus that follows.
        //
        // Off entirely when not on loopback: the signing page is safe because
        // only the person sitting at that machine can open it. Served from a
        // host the caller does not control, it is a page on someone else's
        // computer, which is no use to them and a hazard to the operator.
        const signingHost = process.env.HOUDINI_HTTP_HOST || "127.0.0.1";
        const signingEnabled = signingHost === "127.0.0.1" || signingHost === "localhost";
        const sharedSigner = signingEnabled ? new SigningServer() : undefined;
        if (!signingEnabled) {
            console.error(
                `Browser signing is disabled: HTTP transport is bound to ${signingHost}, not loopback. ` +
                    "Use the stdio transport for local signing.",
            );
        }

        app.all("/mcp", async (req, res) => {
            const requestServer = createMcpServer(client, {
                signer: sharedSigner,
                signing: signingEnabled,
            });
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

        // Loopback by default. This server spends a funded wallet — every tool
        // call costs USDC and createExchange costs $0.01 — and it has no
        // authentication, so binding every interface put the operator's wallet
        // behind an open port. Set HOUDINI_HTTP_HOST to override deliberately,
        // and put authentication in front of it if you do.
        const host = process.env.HOUDINI_HTTP_HOST || "127.0.0.1";

        const httpServer = app.listen(port, host, () => {
            console.error(`HoudiniSwap MCP server (HTTP) listening on ${host}:${port}`);
            if (host !== "127.0.0.1" && host !== "localhost") {
                console.error(
                    `WARNING: bound to ${host}, which is reachable beyond this machine. There is no ` +
                        "authentication on /mcp, and every tool call spends the configured wallet. " +
                        "Put an authenticating proxy in front of it.",
                );
            }
        });

        // Otherwise EADDRINUSE crashes with a raw stack that never reaches the
        // handler below.
        httpServer.on("error", (err: NodeJS.ErrnoException) => {
            console.error(
                err.code === "EADDRINUSE"
                    ? `Port ${port} is already in use. Set PORT to a free port.`
                    : `HTTP server error: ${err.message}`,
            );
            process.exit(1);
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
