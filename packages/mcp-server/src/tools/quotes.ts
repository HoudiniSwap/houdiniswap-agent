import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HoudiniClient, QuoteResult } from "@houdiniswap/agent-shared";
import { z } from "zod";
import { asToolResult, compactQuoteResult } from "../shape.js";

export const registerQuoteTools = (server: McpServer, client: HoudiniClient) => {
    server.tool(
        "getQuote",
        "Get swap quotes for a token pair and amount. Returns the best quotes from CEX and DEX providers, sorted by best rate. Use token IDs from getTokens.",
        {
            from: z.string().describe("Source token ID (from getTokens)"),
            to: z.string().describe("Destination token ID (from getTokens)"),
            amount: z.number().positive().describe("Amount to swap in source token units"),
            types: z.array(z.enum(["standard", "private", "dex"])).optional().describe("Quote types to include (default: all)"),
            slippage: z.number().min(0).max(50).optional().describe("Max slippage percentage for DEX quotes"),
            senderAddress: z.string().optional().describe("Sender wallet address (required for DEX)"),
            receiverAddress: z.string().optional().describe("Receiver wallet address"),
            sort: z.enum(["amountOut", "amountOutUsd", "amountIn", "duration"]).optional().describe("Sort quotes by"),
            sortOrder: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
            // The API has supported these all along; the tool simply never
            // exposed them, so the skill's "only use ChangeNow" and privacy
            // rotation flows were impossible to carry out.
            swaps: z.array(z.string()).optional().describe("Only quote these providers, by shortName from getSwapProviders (e.g. ['cn','se']). Omit for all."),
            rotatePayoutWallets: z.boolean().optional().describe("Rotate payout wallets for better privacy. CEX quotes only."),
            deviationThreshold: z.number().min(0).max(100).optional().describe("Max price deviation % when rotating wallets (default 5). Only used with rotatePayoutWallets."),
            rotationLookback: z.number().int().min(1).max(100).optional().describe("Recent orders to check for path rotation (default 10). Only used with rotatePayoutWallets."),
            rotateFallback: z.boolean().optional().describe("If strict rotation exhausts every rotated route, fall back to a non-rotated one. Requires rotatePayoutWallets."),
            amountType: z.enum(["send", "receive"]).optional().describe("'send' (default): amount is what the user sends. 'receive': amount is what they want to receive — requires fixed=true, and is standard CEX quotes only."),
            fixed: z.boolean().optional().describe("Request fixed-rate quotes; only providers supporting fixed rate are returned."),
            useXmr: z.boolean().optional().describe("For private swaps, use Monero as the intermediate hop instead of another L1."),
            refundAddress: z.string().optional().describe("Sender address for refunds if a fixed-rate swap fails."),
            inLegIncludedSwaps: z.array(z.string()).optional().describe("Private swaps only: allowlist of providers for the first hop."),
            inLegExcludedSwaps: z.array(z.string()).optional().describe("Private swaps only: blocklist of providers for the first hop."),
            outLegIncludedSwaps: z.array(z.string()).optional().describe("Private swaps only: allowlist of providers for the second hop."),
            outLegExcludedSwaps: z.array(z.string()).optional().describe("Private swaps only: blocklist of providers for the second hop."),
            limitPerType: z.number().int().min(1).max(50).optional().default(5).describe("Best quotes to keep per type (default 5). A pair can return 100+ quotes; the response reports how many were omitted."),
            verbose: z.boolean().optional().describe("Return the full unfiltered API response"),
        },
        async ({ limitPerType, verbose, ...params }) => {
            const result = await client.get<QuoteResult>("/quotes", params);
            if (verbose) return asToolResult(result);
            return asToolResult(compactQuoteResult(result, limitPerType ?? 5, params.swaps));
        },
    );
};
