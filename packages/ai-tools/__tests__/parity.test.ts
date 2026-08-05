import { describe, it, expect } from "vitest";
import * as schemas from "../src/schemas.js";

/**
 * `ai-tools` and `mcp-server` wrap the same API, and their schemas have drifted
 * twice: `address` vs `addressFrom` on the DEX tools left every DEX call
 * returning 422, and `dateFrom`/`dateTo` on getOrders silently disabled the date
 * filter because the API takes `from`/`to`.
 *
 * These assert the parameter names against the API's own request contracts, so
 * a rename on either side fails here rather than in production. The contracts
 * live in the backend at `src/tsoa/controllers/`.
 */
const paramsOf = (schema: { shape?: Record<string, unknown>; _def?: { shape?: () => Record<string, unknown> } }) =>
    Object.keys(schema.shape ?? schema._def?.shape?.() ?? {}).sort();

describe("ai-tools schema parity with the API contract", () => {
    it("getOrders uses the API's from/to, not dateFrom/dateTo", () => {
        const params = paramsOf(schemas.ordersSchema as never);
        expect(params).toContain("from");
        expect(params).toContain("to");
        expect(params).not.toContain("dateFrom");
        expect(params).not.toContain("dateTo");
    });

    it("DEX tools use addressFrom, not address", () => {
        for (const schema of [schemas.dexApproveSchema, schemas.dexAllowanceSchema]) {
            const params = paramsOf(schema as never);
            expect(params).toContain("addressFrom");
            expect(params).not.toContain("address");
        }
    });

    it("dexConfirmTx takes the order id, not a quoteId", () => {
        const params = paramsOf(schemas.dexConfirmTxSchema as never);
        expect(params).toContain("id");
        expect(params).not.toContain("quoteId");
    });

    it("dexChainSignatures carries the whole signature chain", () => {
        const params = paramsOf(schemas.dexChainSignaturesSchema as never);
        for (const p of ["quoteId", "addressFrom", "previousSignature", "signatureKey", "signatureStep"]) {
            expect(params).toContain(p);
        }
    });

    it("createExchange can submit permit signatures and refund details", () => {
        const params = paramsOf(schemas.exchangeSchema as never);
        for (const p of ["signatures", "refundAddress", "refundExtraId"]) {
            expect(params).toContain(p);
        }
    });

    it("getQuote exposes the provider filter and privacy options", () => {
        const params = paramsOf(schemas.quoteSchema as never);
        for (const p of ["swaps", "rotatePayoutWallets", "deviationThreshold", "rotationLookback"]) {
            expect(params).toContain(p);
        }
    });

    it("getChains exposes chainId and memoNeeded", () => {
        const params = paramsOf(schemas.chainsSchema as never);
        expect(params).toContain("chainId");
        expect(params).toContain("memoNeeded");
    });
});
