import { AsyncLocalStorage } from "node:async_hooks";
import { BASE_NETWORK, SOLANA_NETWORK, type X402Payment } from "@houdiniswap/agent-shared";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * The payments made while one tool call runs. A tool can make several paid
 * requests (the swap flow does), and with the HTTP transport calls overlap, so
 * the client reports into whichever call is running rather than into a shared
 * list.
 */
const scope = new AsyncLocalStorage<X402Payment[]>();

/** Pass as `onPayment` to the client. */
export const recordPayment = (payment: X402Payment): void => {
    scope.getStore()?.push(payment);
};

const NETWORKS: Record<string, { name: string; tx: string }> = {
    [BASE_NETWORK]: { name: "Base", tx: "https://basescan.org/tx/" },
    [SOLANA_NETWORK]: { name: "Solana", tx: "https://solscan.io/tx/" },
};

const networkName = (network: string): string => NETWORKS[network]?.name ?? network;

const usdc = (atomic: string): string => {
    const n = Number(atomic) / 1e6;
    return Number.isFinite(n) ? `${n} USDC` : `${atomic} USDC atomic units`;
};

/**
 * Without this the model has no way to know which wallet paid: the receipt
 * arrives in a response header the tool result never showed, and asked
 * "where did the fee come from", it could only guess from the config.
 */
export const describePayment = (p: X402Payment): string => {
    const from = p.payer ? ` from ${p.payer}` : "";
    const tx = p.transaction
        ? `, transaction ${NETWORKS[p.network] ? NETWORKS[p.network].tx : ""}${p.transaction}`
        : "";
    const refused = p.refused
        .map((r) => ` ${networkName(r.network)} was tried first and refused${r.reason ? ` (${r.reason})` : ""}; nothing was charged there.`)
        .join("");
    return `x402 payment for this call: ${usdc(p.amount)} on ${networkName(p.network)}${from}${tx}.${refused}`;
};

const withReceipts = (result: CallToolResult, payments: X402Payment[]): CallToolResult =>
    payments.length === 0
        ? result
        : { ...result, content: [...(result.content ?? []), { type: "text", text: payments.map(describePayment).join("\n") }] };

type ToolHandler = (...args: never[]) => CallToolResult | Promise<CallToolResult>;

/**
 * Runs a tool handler and appends the payments it made to its result. A handler
 * that throws after paying still reports them, since the money is spent either
 * way; the error is returned the way the SDK would return it.
 */
export const withPaymentReceipts = <H extends ToolHandler>(handler: H): H =>
    ((...args: Parameters<H>) => {
        const payments: X402Payment[] = [];
        return scope.run(payments, async () => {
            try {
                return withReceipts(await handler(...args), payments);
            } catch (err) {
                if (payments.length === 0) throw err;
                return withReceipts(
                    { content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }], isError: true },
                    payments,
                );
            }
        });
    }) as H;
