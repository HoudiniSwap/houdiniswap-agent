import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HoudiniClient } from "@houdiniswap/agent-shared";

export const registerResources = (server: McpServer, client: HoudiniClient) => {
    server.resource(
        "openapi",
        "houdiniswap://openapi",
        {
            description: "HoudiniSwap Partner API v2 OpenAPI 3.0 specification",
            mimeType: "application/json",
        },
        async () => {
            try {
                // OpenAPI spec is freely accessible (no auth needed)
                const res = await fetch(`${client.getBaseUrl()}/openapi.json`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const spec = await res.text();
                return {
                    contents: [{ uri: "houdiniswap://openapi", text: spec, mimeType: "application/json" }],
                };
            } catch {
                return {
                    contents: [{ uri: "houdiniswap://openapi", text: '{"error": "Failed to fetch OpenAPI spec"}', mimeType: "application/json" }],
                };
            }
        },
    );

    server.resource(
        "pricing",
        "houdiniswap://pricing",
        {
            description: "HoudiniSwap x402 pricing and rate limits for agent access",
            mimeType: "text/plain",
        },
        async () => ({
            contents: [{
                uri: "houdiniswap://pricing",
                text: [
                    "HoudiniSwap x402 Pay-Per-Request Pricing (USDC)",
                    "",
                    "Read operations ($0.0001):",
                    "  GET /tokens, GET /chains, GET /swaps, GET /minMax, GET /rateLimits",
                    "  POST /dex/approve, POST /dex/allowance, POST /dex/chainSignatures",
                    "",
                    "Quote operations ($0.001):",
                    "  GET /quotes",
                    "",
                    "Exchange operations ($0.01):",
                    "  POST /exchanges, POST /dex/confirmTx",
                    "",
                    "Status operations ($0.0001):",
                    "  GET /orders, GET /orders/{id}",
                    "",
                    "Free endpoints (no payment required):",
                    "  GET /health, GET /openapi.json",
                    "",
                    "Rate limits: 60 requests/minute per payer address",
                    "Network: Base (eip155:8453) — USDC payments",
                    "",
                    "A complete swap flow costs ~$0.012:",
                    "  2x getTokens ($0.0002) + getMinMax ($0.0001) + getQuote ($0.001) + createExchange ($0.01) + getOrder ($0.0001)",
                ].join("\n"),
                mimeType: "text/plain",
            }],
        }),
    );
};
