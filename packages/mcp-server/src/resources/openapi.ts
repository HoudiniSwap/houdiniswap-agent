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
                    // Mirrors routeOperationMappings / publicRouteMappings in the
                    // backend's src/tsoa/x402Config.ts. This previously listed
                    // GET /health and GET /openapi.json as free — neither is a
                    // public route — and omitted GET /status, which is the only
                    // one that actually is.
                    "Read operations ($0.0001):",
                    "  GET /tokens, GET /tokens/{id}, GET /chains, GET /swaps, GET /minMax, GET /rateLimits",
                    "  POST /dex/approve, POST /dex/allowance, POST /dex/chainSignatures",
                    "",
                    "Quote operations ($0.001):",
                    "  GET /quotes, GET /quotes/byChainAddress",
                    "",
                    "Exchange operations ($0.01):",
                    "  POST /exchanges, POST /dex/confirmTx",
                    "  POST /exchanges/multi, POST /exchanges/multi/recovery,",
                    "  POST /exchanges/multi/{id}/tx/build, GET /exchanges/multi/{id}/tx",
                    "",
                    "Status operations ($0.0001):",
                    "  GET /orders, GET /orders/{id}, GET /exchanges/multi/{id}",
                    "",
                    "Free endpoints (no payment required):",
                    "  GET /status — the only unpaid route. It is not exposed as a tool,",
                    "  so every tool call costs at least $0.0001 and a funded wallet is required.",
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
