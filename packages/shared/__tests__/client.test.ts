import { describe, it, expect, vi, beforeEach } from "vitest";
import { HoudiniClient, HoudiniApiError } from "../src/client.js";

// Mock the x402 module to avoid importing real crypto libs in unit tests
vi.mock("../src/x402.js", () => ({
    createX402Fetch: vi.fn(() => vi.fn()),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const jsonResponse = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });

beforeEach(() => {
    vi.clearAllMocks();
});

describe("HoudiniClient", () => {
    describe("base URL", () => {
        it("defaults to https://api-partner.houdiniswap.com/v2", async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
            const client = new HoudiniClient({ auth: { type: "none" } });
            await client.get("/health");
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining("https://api-partner.houdiniswap.com/v2/health"),
                expect.any(Object),
            );
        });

        it("uses custom base URL", async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
            const client = new HoudiniClient({
                baseUrl: "http://localhost:3003/v2",
                auth: { type: "none" },
            });
            await client.get("/tokens");
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining("http://localhost:3003/v2/tokens"),
                expect.any(Object),
            );
        });

        it("strips trailing slash from base URL", async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
            const client = new HoudiniClient({
                baseUrl: "http://localhost:3003/v2/",
                auth: { type: "none" },
            });
            await client.get("/tokens");
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining("http://localhost:3003/v2/tokens"),
                expect.any(Object),
            );
        });
    });

    describe("GET requests", () => {
        it("constructs URL with query params", async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ total: 1, tokens: [] }));
            const client = new HoudiniClient({ auth: { type: "none" } });
            await client.get("/tokens", { symbol: "BTC", hasCex: true, pageSize: 5 });

            const calledUrl = mockFetch.mock.calls[0][0] as string;
            const url = new URL(calledUrl);
            expect(url.searchParams.get("symbol")).toBe("BTC");
            expect(url.searchParams.get("hasCex")).toBe("true");
            expect(url.searchParams.get("pageSize")).toBe("5");
        });

        it("skips undefined and null params", async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ total: 0, tokens: [] }));
            const client = new HoudiniClient({ auth: { type: "none" } });
            await client.get("/tokens", { symbol: "BTC", chain: undefined, address: null });

            const calledUrl = mockFetch.mock.calls[0][0] as string;
            const url = new URL(calledUrl);
            expect(url.searchParams.get("symbol")).toBe("BTC");
            expect(url.searchParams.has("chain")).toBe(false);
            expect(url.searchParams.has("address")).toBe(false);
        });

        it("returns parsed JSON", async () => {
            const data = { total: 2, tokens: [{ symbol: "BTC" }, { symbol: "ETH" }] };
            mockFetch.mockResolvedValueOnce(jsonResponse(data));
            const client = new HoudiniClient({ auth: { type: "none" } });
            const result = await client.get("/tokens");
            expect(result).toEqual(data);
        });
    });

    describe("POST requests", () => {
        it("sends JSON body with correct headers", async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({ houdiniId: "H123" }));
            const client = new HoudiniClient({ auth: { type: "none" } });
            await client.post("/exchanges", { quoteId: "q1", addressTo: "0xabc" });

            const [, opts] = mockFetch.mock.calls[0];
            expect(opts.method).toBe("POST");
            expect(opts.headers["Content-Type"]).toBe("application/json");
            expect(JSON.parse(opts.body)).toEqual({ quoteId: "q1", addressTo: "0xabc" });
        });
    });

    describe("authentication", () => {
        it("sets Authorization header for apiKey auth", async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({}));
            const client = new HoudiniClient({
                auth: { type: "apiKey", key: "partner1:secret123" },
            });
            await client.get("/tokens");

            const [, opts] = mockFetch.mock.calls[0];
            expect(opts.headers.Authorization).toBe("partner1:secret123");
        });

        it("sets partner-id header for partnerId auth", async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({}));
            const client = new HoudiniClient({
                auth: { type: "partnerId", id: "my-partner" },
            });
            await client.get("/tokens");

            const [, opts] = mockFetch.mock.calls[0];
            expect(opts.headers["partner-id"]).toBe("my-partner");
        });

        it("sets no auth headers for none auth", async () => {
            mockFetch.mockResolvedValueOnce(jsonResponse({}));
            const client = new HoudiniClient({ auth: { type: "none" } });
            await client.get("/tokens");

            const [, opts] = mockFetch.mock.calls[0];
            expect(opts.headers.Authorization).toBeUndefined();
            expect(opts.headers["partner-id"]).toBeUndefined();
        });
    });

    describe("error handling", () => {
        it("throws HoudiniApiError on non-ok response", async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ code: "NOT_FOUND", message: "Token not found" }, 404),
            );
            const client = new HoudiniClient({ auth: { type: "none" } });

            await expect(client.get("/tokens/xyz")).rejects.toThrow(HoudiniApiError);
            try {
                await client.get("/tokens/xyz");
            } catch (err) {
                // Need fresh mock for second call
            }
        });

        it("includes status and error body in HoudiniApiError", async () => {
            const errorBody = { code: "VALIDATION_ERROR", message: "Invalid amount" };
            mockFetch.mockResolvedValueOnce(jsonResponse(errorBody, 422));
            const client = new HoudiniClient({ auth: { type: "none" } });

            try {
                await client.get("/quotes?amount=-1");
                expect.unreachable("Should have thrown");
            } catch (err) {
                expect(err).toBeInstanceOf(HoudiniApiError);
                const apiErr = err as HoudiniApiError;
                expect(apiErr.status).toBe(422);
                expect(apiErr.error.code).toBe("VALIDATION_ERROR");
                expect(apiErr.message).toContain("Invalid amount");
            }
        });

        it("explains a 402 with an empty body when no key is configured", async () => {
            // The x402 middleware answers with `{}`, which used to render as
            // "HTTP 402: Unknown error" — the most common failure, unexplained.
            mockFetch.mockResolvedValueOnce(jsonResponse({}, 402));
            const client = new HoudiniClient({ auth: { type: "none" } });

            try {
                await client.get("/chains");
                expect.unreachable("Should have thrown");
            } catch (err) {
                const apiErr = err as HoudiniApiError;
                expect(apiErr.status).toBe(402);
                expect(apiErr.message).not.toContain("Unknown error");
                expect(apiErr.message).toContain("HOUDINI_X402_PRIVATE_KEY");
                expect(apiErr.message).toContain("USDC on Base");
            }
        });

        // The x402 auth path wraps fetch in the payment client, so driving it
        // through HoudiniClient would mean simulating a full 402 challenge and
        // settlement. The message itself is what matters here.
        it("explains a 402 differently when a wallet is configured", () => {
            const err = new HoudiniApiError(402, {}, "x402");
            expect(err.message).toContain("not accepted");
            expect(err.message).toContain("USDC on Base");
            expect(err.message).not.toContain("Unknown error");
        });

        it("names the USDC contract so a wrong-chain balance is diagnosable", () => {
            const err = new HoudiniApiError(402, {}, "x402");
            expect(err.message).toContain("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
        });

        it("still prefers a server-supplied message on 402", async () => {
            mockFetch.mockResolvedValueOnce(
                jsonResponse({ code: "RATE_LIMIT", message: "Too many payments" }, 402),
            );
            const client = new HoudiniClient({ auth: { type: "none" } });

            try {
                await client.get("/chains");
                expect.unreachable("Should have thrown");
            } catch (err) {
                expect((err as HoudiniApiError).message).toContain("Too many payments");
            }
        });

        it("handles non-JSON error body gracefully", async () => {
            mockFetch.mockResolvedValueOnce(
                new Response("Internal Server Error", { status: 500 }),
            );
            const client = new HoudiniClient({ auth: { type: "none" } });

            try {
                await client.get("/crash");
                expect.unreachable("Should have thrown");
            } catch (err) {
                expect(err).toBeInstanceOf(HoudiniApiError);
                const apiErr = err as HoudiniApiError;
                expect(apiErr.status).toBe(500);
            }
        });
    });

    describe("getBaseUrl", () => {
        it("returns the configured base URL", () => {
            const client = new HoudiniClient({
                baseUrl: "http://localhost:3003/v2",
                auth: { type: "none" },
            });
            expect(client.getBaseUrl()).toBe("http://localhost:3003/v2");
        });
    });
});
