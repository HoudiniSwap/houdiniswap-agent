import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HoudiniClient } from "@houdiniswap/agent-shared";
import { z } from "zod";
import { asToolResult } from "../shape.js";

// Parameter names here mirror the API's request bodies exactly. They previously
// did not — `address` instead of `addressFrom`, `quoteId` instead of `id` — and
// the API rejects unknown properties, so every DEX call returned 422.
//
// No field stripping on the responses: they are unsigned transaction data, and a
// dropped field is a transaction the user cannot sign. Only the indentation goes.
export const registerDexTools = (server: McpServer, client: HoudiniClient) => {
    server.tool(
        "dexApprove",
        "Get token approval transaction data for a DEX swap. Returns the transaction(s) or EIP-2612 permit signature data needed before executing the swap.",
        {
            quoteId: z.string().describe("Quote ID from getQuote (DEX quote)"),
            addressFrom: z.string().describe("Address the amount will be deducted from (EVM 0x… or Tron T…)"),
            usePermit: z.boolean().optional().describe("Use permit instead of approve; defaults to true where supported"),
        },
        async (params) => {
            const result = await client.post("/dex/approve", params);
            return asToolResult(result);
        },
    );

    server.tool(
        "dexCheckAllowance",
        "Check if a token allowance is sufficient for a DEX swap.",
        {
            quoteId: z.string().describe("Quote ID from getQuote (DEX quote)"),
            addressFrom: z.string().describe("Address the amount will be deducted from (EVM 0x… or Tron T…)"),
            usePermit: z.boolean().optional().describe("Use permit instead of approve; defaults to true where supported"),
        },
        async (params) => {
            const result = await client.post("/dex/allowance", params);
            return asToolResult(result);
        },
    );

    server.tool(
        "dexConfirmTx",
        "Confirm a DEX transaction after the user has signed and submitted it on-chain.",
        {
            id: z.string().min(3).describe("The Houdini order ID (houdiniId from createExchange) — not the quote ID"),
            txHash: z.string().optional().describe("Transaction hash. Required for on-chain orders, optional for off-chain."),
        },
        async (params) => {
            const result = await client.post("/dex/confirmTx", params);
            return asToolResult(result);
        },
    );

    server.tool(
        "dexChainSignatures",
        "Get the next signature in a multi-step DEX chain (e.g. permit + bridge). Call repeatedly until the chain is complete.",
        {
            quoteId: z.string().describe("Quote ID from getQuote"),
            addressFrom: z.string().describe("EVM address the amount will be deducted from"),
            previousSignature: z
                .object({
                    signature: z.string(),
                    key: z.string(),
                    swapRequiredMetadata: z.record(z.unknown()).optional(),
                })
                .describe("The signature object produced by the wallet in the previous step"),
            signatureKey: z.string().describe("Signature key returned by the previous approve or chainSignatures call"),
            signatureStep: z.number().int().min(0).describe("Step number in the signature chain sequence"),
        },
        async (params) => {
            const result = await client.post("/dex/chainSignatures", params);
            return asToolResult(result);
        },
    );
};
