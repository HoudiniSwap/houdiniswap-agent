import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HoudiniClient } from "@houdiniswap/agent-shared";
import { z } from "zod";

export const registerDexTools = (server: McpServer, client: HoudiniClient) => {
    server.tool(
        "dexApprove",
        "Get token approval transaction data for a DEX swap. Returns the transaction(s) or EIP-2612 permit signature data needed before executing the swap.",
        {
            quoteId: z.string().describe("Quote ID from getQuote (DEX quote)"),
            address: z.string().describe("Wallet address that will approve the token"),
        },
        async (params) => {
            const result = await client.post("/dex/approve", params);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        },
    );

    server.tool(
        "dexCheckAllowance",
        "Check if a token allowance is sufficient for a DEX swap.",
        {
            quoteId: z.string().describe("Quote ID from getQuote (DEX quote)"),
            address: z.string().describe("Wallet address to check allowance for"),
        },
        async (params) => {
            const result = await client.post("/dex/allowance", params);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        },
    );

    server.tool(
        "dexConfirmTx",
        "Confirm a DEX transaction after the user has signed and submitted it on-chain.",
        {
            quoteId: z.string().describe("Quote ID from getQuote"),
            txHash: z.string().describe("On-chain transaction hash"),
        },
        async (params) => {
            const result = await client.post("/dex/confirmTx", params);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        },
    );

    server.tool(
        "dexChainSignatures",
        "Get the next signature in a multi-step DEX chain (e.g. permit + bridge). Call repeatedly until isComplete is true.",
        {
            quoteId: z.string().describe("Quote ID from getQuote"),
            previousSignature: z.string().optional().describe("Previous signature from last call"),
        },
        async (params) => {
            const result = await client.post("/dex/chainSignatures", params);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            };
        },
    );
};
