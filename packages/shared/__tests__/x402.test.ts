import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Records when each payment payload is created and when its paid retry finishes,
// so the test can prove the two never interleave across concurrent requests.
const paymentEvents: Array<{ id: number; phase: "sign" | "retry-done"; at: number }> = [];
let paymentSeq = 0;
let activePayments = 0;
let maxConcurrentPayments = 0;

vi.mock("viem/accounts", () => ({
    privateKeyToAccount: vi.fn(() => ({ address: "0xtest" })),
}));

vi.mock("@x402/evm/exact/client", () => ({
    registerExactEvmScheme: vi.fn(),
}));

vi.mock("@x402/core/client", () => ({
    x402Client: class {
        async createPaymentPayload() {
            const id = ++paymentSeq;
            activePayments += 1;
            maxConcurrentPayments = Math.max(maxConcurrentPayments, activePayments);
            paymentEvents.push({ id, phase: "sign", at: Date.now() });
            return { id };
        }
    },
    x402HTTPClient: class {
        getPaymentRequiredResponse() {
            return { accepts: [] };
        }
        encodePaymentSignatureHeader(payload: { id: number }) {
            return { "x-payment": String(payload.id) };
        }
    },
}));

const { createX402Fetch } = await import("../src/x402.js");

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
    paymentEvents.length = 0;
    paymentSeq = 0;
    activePayments = 0;
    maxConcurrentPayments = 0;
    mockFetch.mockReset();
    // Unpaid request -> 402; paid retry (carries x-payment) -> 200.
    mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
        const paid = Boolean((init?.headers as Record<string, string>)?.["x-payment"]);
        if (!paid) return new Response("{}", { status: 402 });
        await new Promise((r) => setTimeout(r, 10)); // settlement takes time
        activePayments -= 1;
        paymentEvents.push({ id: paymentSeq, phase: "retry-done", at: Date.now() });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
});

afterEach(() => {
    vi.useRealTimers();
});

describe("createX402Fetch", () => {
    it("passes non-402 responses straight through without paying", async () => {
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        const f = createX402Fetch(`0x${"11".repeat(32)}`);
        const res = await f("https://api.test/x");
        expect(res.status).toBe(200);
        expect(paymentEvents).toHaveLength(0);
    });

    /**
     * The facilitator settles each payment on-chain. Two settlements in flight
     * from the same payer collide — it answers 402 with
     * `invalid_exact_evm_transaction_failed`, and firing three concurrent paid
     * requests reproducibly left exactly one succeeding. `swap` triggered this on
     * every run, because it looks up both tokens with Promise.all.
     */
    it("serialises concurrent payments instead of settling them in parallel", async () => {
        vi.useFakeTimers();
        const f = createX402Fetch(`0x${"11".repeat(32)}`);

        const all = Promise.all([
            f("https://api.test/a"),
            f("https://api.test/b"),
            f("https://api.test/c"),
        ]);
        await vi.advanceTimersByTimeAsync(60_000);
        const responses = await all;

        expect(responses.every((r) => r.status === 200)).toBe(true);
        expect(maxConcurrentPayments).toBe(1);
        expect(paymentEvents.filter((e) => e.phase === "sign")).toHaveLength(3);

        // sign -> retry-done -> sign -> retry-done -> ... never sign,sign
        const phases = paymentEvents.map((e) => e.phase);
        expect(phases).toEqual([
            "sign", "retry-done",
            "sign", "retry-done",
            "sign", "retry-done",
        ]);
    });

    /**
     * Serialisation is required — concurrent settlements from one wallet fail at
     * the facilitator — but it means a single stalled request blocks every
     * payment behind it. Without a timeout that is permanent and silent: the MCP
     * server stops paying for anything, forever, with nothing logged.
     */
    it("does not wedge every later payment when one request hangs", async () => {
        vi.useFakeTimers();
        let call = 0;
        mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
            const paid = Boolean((init?.headers as Record<string, string>)?.["x-payment"]);
            if (!paid) return new Response("{}", { status: 402 });
            call += 1;
            if (call === 1) await new Promise(() => {}); // stalls forever
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
        });

        const f = createX402Fetch(`0x${"11".repeat(32)}`);
        const first = f("https://api.test/hangs").then(
            () => "resolved",
            (e: Error) => `rejected: ${e.message}`,
        );
        const second = f("https://api.test/behind-it").then(
            (r) => `status ${r.status}`,
            (e: Error) => `rejected: ${e.message}`,
        );

        await vi.advanceTimersByTimeAsync(180_000);

        expect(await first).toMatch(/timed out/i);
        expect(await second).toBe("status 200");
    });

    it("keeps serving later payments after one fails", async () => {
        vi.useFakeTimers();
        let call = 0;
        mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
            const paid = Boolean((init?.headers as Record<string, string>)?.["x-payment"]);
            if (!paid) return new Response("{}", { status: 402 });
            call += 1;
            if (call === 1) throw new Error("settlement exploded");
            return new Response(JSON.stringify({ ok: true }), { status: 200 });
        });

        const f = createX402Fetch(`0x${"11".repeat(32)}`);
        const first = f("https://api.test/a").catch((e: Error) => e.message);
        const second = f("https://api.test/b");
        await vi.advanceTimersByTimeAsync(60_000);

        expect(await first).toBe("settlement exploded");
        expect((await second).status).toBe(200);
    });
});

/**
 * Money-path invariant with no previous test: exactly one signed authorisation
 * per 402. Two payments for one logical call would require two calls to
 * createPaymentPayload, so pinning the count pins the property.
 *
 * This is what makes a timeout safe to add. A timeout cannot double-spend — it
 * can only lose a single payment if the facilitator settles after we stop
 * waiting, and EIP-3009 nonce replay protection means one authorisation settles
 * at most once regardless.
 */
describe("payment count invariant", () => {
    it("signs exactly one authorisation per 402, even when the retry fails", async () => {
        vi.useFakeTimers();
        mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
            const paid = Boolean((init?.headers as Record<string, string>)?.["x-payment"]);
            if (!paid) return new Response("{}", { status: 402 });
            return new Response("{}", { status: 402 }); // facilitator refuses
        });

        const f = createX402Fetch(`0x${"11".repeat(32)}`);
        const res = await f("https://api.test/refused");
        await vi.advanceTimersByTimeAsync(120_000);

        expect(res.status).toBe(402);
        expect(paymentEvents.filter((e) => e.phase === "sign")).toHaveLength(1);
    });

    it("signs exactly one authorisation per 402 on the success path", async () => {
        vi.useFakeTimers();
        const f = createX402Fetch(`0x${"11".repeat(32)}`);
        const p = f("https://api.test/ok");
        await vi.advanceTimersByTimeAsync(120_000);
        await p;
        expect(paymentEvents.filter((e) => e.phase === "sign")).toHaveLength(1);
    });

    it("does not sign at all when the endpoint is free", async () => {
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
        const f = createX402Fetch(`0x${"11".repeat(32)}`);
        await f("https://api.test/status");
        expect(paymentEvents).toHaveLength(0);
    });
});
