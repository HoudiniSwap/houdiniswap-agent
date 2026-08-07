import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HoudiniClient, Order } from "@houdiniswap/agent-shared";
import { z } from "zod";
import { asToolResult } from "../shape.js";
import { SigningServer } from "../signing/server.js";
import type { SignableTransaction } from "../signing/page.js";

/** The token as GET /orders/:id returns it, before any shaping. */
interface RawToken {
    symbol?: string;
    chainId?: number;
    chainData?: { chainId?: number };
}

/**
 * Browser signing for DEX swaps, so a user is never asked to paste a private key
 * into a script. See docs/local-signing.md.
 *
 * Two tools rather than one blocking call: a browser signature can take minutes,
 * and a tool that blocks that long is indistinguishable from a hang.
 */
export const registerSigningTools = (server: McpServer, client: HoudiniClient) => {
    const signer = new SigningServer();

    server.tool(
        "dexSignRequest",
        "Open a local page in the user's browser to sign a DEX swap with their own wallet. Use this instead of asking the user to handle raw transaction data. Costs one status call ($0.0001) to read the order; the signing itself is local and free.",
        {
            houdiniId: z.string().describe("The Houdini order ID from createExchange"),
        },
        async ({ houdiniId }) => {
            const order = await client.get<Order & { metadata?: unknown; isDex?: boolean; expires?: string }>(
                `/orders/${encodeURIComponent(houdiniId)}`,
            );

            if (!order?.isDex) {
                return asToolResult({
                    error: `Order ${houdiniId} is not a DEX order. CEX orders need no signature — show the user the deposit address instead.`,
                });
            }

            // metadata arrives as an object on creation and as a JSON string when
            // read back from the order; both shapes reach this tool.
            let tx: SignableTransaction | undefined;
            const raw = order.metadata;
            try {
                tx = (typeof raw === "string" ? JSON.parse(raw) : raw) as SignableTransaction;
            } catch {
                tx = undefined;
            }

            if (!tx?.to || !tx?.data) {
                return asToolResult({
                    error: `Order ${houdiniId} carries no signable transaction. It may already be confirmed, or it may be a route that funds via a deposit address.`,
                });
            }

            // GET /orders/:id nests the chain under chainData; the shaped order
            // returned by createExchange flattens chainId onto the token. This
            // reads the raw endpoint, so chainData comes first — getting it the
            // other way round made every request fail with "could not determine
            // the chain", and the mocked order in the tests hid it.
            const inToken = (order as { inToken?: RawToken }).inToken;
            const chainId = inToken?.chainData?.chainId ?? inToken?.chainId;
            if (typeof chainId !== "number") {
                return asToolResult({ error: `Could not determine the chain for order ${houdiniId}.` });
            }

            const expiresAt = order.expires ? Date.parse(order.expires) : Date.now() + 15 * 60_000;
            // So the page can show what the swap does, not just where the
            // calldata points. Every router encodes its swap differently, so
            // these come from the order rather than from decoding `data`.
            // inSymbol/outSymbol hold token ids on DEX orders; the embedded
            // token documents carry the real ticker, so prefer those.
            const outToken = (order as { outToken?: RawToken }).outToken;
            const pending = await signer.request(houdiniId, tx, chainId, expiresAt, {
                inAmount: order.inAmount,
                inSymbol: inToken?.symbol ?? order.inSymbol,
                outAmount: order.outAmount,
                outSymbol: outToken?.symbol ?? order.outSymbol,
                receiverAddress: order.receiverAddress,
            });

            return asToolResult({
                url: pending.url,
                token: pending.token,
                expiresAt: new Date(expiresAt).toISOString(),
                chainId,
                instructions:
                    "Give the user this URL to open in the browser where their wallet extension is installed. " +
                    "Their wallet will show its own confirmation. Then poll dexSignStatus with the token, and " +
                    "call dexConfirmTx with the resulting txHash.",
            });
        },
    );

    server.tool(
        "dexSignStatus",
        "Check whether the user has signed a transaction requested via dexSignRequest. Poll this after giving them the URL. Free.",
        {
            token: z.string().describe("The token returned by dexSignRequest"),
        },
        async ({ token }) => {
            const entry = signer.status(token);
            if (!entry) {
                return asToolResult({
                    status: "expired",
                    error: "Unknown or expired token. Call dexSignRequest again to get a fresh link.",
                });
            }
            return asToolResult({
                status: entry.status,
                ...(entry.txHash ? { txHash: entry.txHash } : {}),
                ...(entry.error ? { error: entry.error } : {}),
                ...(entry.status === "signed"
                    ? { next: `Call dexConfirmTx with id "${entry.houdiniId}" and this txHash.` }
                    : {}),
            });
        },
    );

    return signer;
};
