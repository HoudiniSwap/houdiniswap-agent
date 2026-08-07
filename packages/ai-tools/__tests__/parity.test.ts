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

    // Asserting only the four that already existed is what let ai-tools fall
    // nine parameters behind mcp-server unnoticed. This lists every getQuote
    // parameter the API accepts, so any future addition on one side fails here.
    it("getQuote exposes every parameter the API accepts", () => {
        const params = paramsOf(schemas.quoteSchema as never);
        const apiParams = [
            "from", "to", "amount", "types", "slippage", "senderAddress", "receiverAddress",
            "sort", "sortOrder", "swaps", "rotatePayoutWallets", "deviationThreshold",
            "rotationLookback", "rotateFallback", "amountType", "fixed", "useXmr",
            "refundAddress", "inLegIncludedSwaps", "inLegExcludedSwaps",
            "outLegIncludedSwaps", "outLegExcludedSwaps",
        ];
        const missing = apiParams.filter((p) => !params.includes(p));
        expect(missing, `getQuote is missing: ${missing.join(", ")}`).toEqual([]);

        // Checked in both directions. GET /quotes binds the whole query object
        // against QuoteQueryParams, which is additionalProperties:false under
        // tsoa's throw-on-extras — so one stray parameter 422s every quote
        // rather than being ignored. A missing-only check stays green through
        // exactly that.
        const extra = params.filter((p) => !apiParams.includes(p));
        expect(extra, `getQuote sends parameters the API rejects: ${extra.join(", ")}`).toEqual([]);
    });

    it("getTokens exposes unverified and hasSelfPrivate", () => {
        const params = paramsOf(schemas.tokensSchema as never);
        expect(params).toContain("unverified");
        expect(params).toContain("hasSelfPrivate");
    });

    // `.default(N).optional()` builds ZodOptional<ZodDefault>, and the optional
    // wrapper short-circuits on undefined before the default fires — so the
    // declared default silently never applied and the server default (1000 for
    // getTokens) took over instead.
    it("applies declared defaults rather than dropping them", () => {
        expect((schemas.tokensSchema as never as { parse: (v: unknown) => Record<string, unknown> }).parse({}))
            .toMatchObject({ page: 1, pageSize: 20 });
        expect((schemas.ordersSchema as never as { parse: (v: unknown) => Record<string, unknown> }).parse({}))
            .toMatchObject({ page: 1, pageSize: 20 });
        expect((schemas.chainsSchema as never as { parse: (v: unknown) => Record<string, unknown> }).parse({}))
            .toMatchObject({ page: 1, pageSize: 100 });
    });

    it("getChains exposes chainId and memoNeeded", () => {
        const params = paramsOf(schemas.chainsSchema as never);
        expect(params).toContain("chainId");
        expect(params).toContain("memoNeeded");
    });
});
