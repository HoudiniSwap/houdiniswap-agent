import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { HoudiniClient, X402Payment } from "@houdiniswap/agent-shared";
import { describePayment, recordPayment, withPaymentReceipts } from "../src/payments.js";
import { createMcpServer } from "../src/server.js";

vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"openapi":"3.0.0"}', { status: 200 })));

const SOLANA_PAYMENT: X402Payment = {
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    amount: "100",
    payer: "CF3LVCCGkayzGXeqXUiU6xwq6nxecfPXUrNB5p2UvEAp",
    transaction: "4Ezsn",
    refused: [],
};

const text = (result: { content?: Array<{ type: string; text?: string }> }) =>
    (result.content ?? []).map((c) => c.text ?? "");

describe("describePayment", () => {
    it("names the amount, network, payer and an explorer link", () => {
        expect(describePayment(SOLANA_PAYMENT)).toBe(
            "x402 payment for this call: 0.0001 USDC on Solana from CF3LVCCGkayzGXeqXUiU6xwq6nxecfPXUrNB5p2UvEAp, transaction https://solscan.io/tx/4Ezsn.",
        );
    });

    it("links Base transactions to Basescan", () => {
        expect(
            describePayment({ network: "eip155:8453", amount: "10000", payer: "0xabc", transaction: "0xdef", refused: [] }),
        ).toBe("x402 payment for this call: 0.01 USDC on Base from 0xabc, transaction https://basescan.org/tx/0xdef.");
    });

    it("says which network refused first and that it charged nothing", () => {
        expect(
            describePayment({
                ...SOLANA_PAYMENT,
                refused: [{ network: "eip155:8453", reason: "invalid_exact_evm_insufficient_balance" }],
            }),
        ).toMatch(/on Solana .* Base was tried first and refused \(invalid_exact_evm_insufficient_balance\); nothing was charged there\.$/);
    });

    it("still reads without a payer or a transaction", () => {
        expect(describePayment({ network: "eip155:8453", amount: "100", refused: [] })).toBe(
            "x402 payment for this call: 0.0001 USDC on Base.",
        );
    });
});

describe("withPaymentReceipts", () => {
    const ok = { content: [{ type: "text" as const, text: "{}" }] };

    it("appends the payments the handler made", async () => {
        const handler = withPaymentReceipts(async () => {
            recordPayment(SOLANA_PAYMENT);
            return ok;
        });
        const result = await handler();
        expect(text(result)).toEqual(["{}", describePayment(SOLANA_PAYMENT)]);
    });

    it("leaves an unpaid result untouched", async () => {
        expect(await withPaymentReceipts(async () => ok)()).toBe(ok);
    });

    it("keeps overlapping calls' payments apart", async () => {
        const paying = (payment: X402Payment, delay: number) =>
            withPaymentReceipts(async () => {
                await new Promise((r) => setTimeout(r, delay));
                recordPayment(payment);
                return ok;
            });
        const base: X402Payment = { network: "eip155:8453", amount: "100", transaction: "0xbase", refused: [] };
        const [first, second] = await Promise.all([paying(SOLANA_PAYMENT, 20)(), paying(base, 5)()]);
        expect(text(first)[1]).toContain("4Ezsn");
        expect(text(first)[1]).not.toContain("0xbase");
        expect(text(second)[1]).toContain("0xbase");
        expect(text(second)[1]).not.toContain("4Ezsn");
    });

    it("reports what was paid when the handler fails afterwards", async () => {
        const result = await withPaymentReceipts(async () => {
            recordPayment(SOLANA_PAYMENT);
            throw new Error("second step failed");
        })();
        expect(result.isError).toBe(true);
        expect(text(result)).toEqual(["second step failed", describePayment(SOLANA_PAYMENT)]);
    });

    it("rethrows when the handler fails without paying", async () => {
        await expect(withPaymentReceipts(async () => { throw new Error("nope"); })()).rejects.toThrow("nope");
    });

    it("ignores payments made outside a tool call", () => {
        expect(() => recordPayment(SOLANA_PAYMENT)).not.toThrow();
    });
});

describe("tools report their payments", () => {
    it("adds the receipt to a registered tool's result", async () => {
        const client = {
            get: async () => {
                recordPayment(SOLANA_PAYMENT);
                return { chains: [] };
            },
            post: async () => ({}),
            getBaseUrl: () => "https://api-partner.houdiniswap.com/v2",
        } as unknown as HoudiniClient;
        const server = createMcpServer(client, { signing: false });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        const mcp = new Client({ name: "test", version: "1.0.0" });
        await mcp.connect(clientTransport);

        const result = await mcp.callTool({ name: "getChains", arguments: {} });
        expect(text(result as never).at(-1)).toBe(describePayment(SOLANA_PAYMENT));

        await mcp.close();
    });
});
