import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getAuthConfig } from "../src/auth.js";

const AUTH_VARS = [
    "HOUDINI_API_KEY",
    "HOUDINI_X402_PRIVATE_KEY",
    "HOUDINI_X402_SVM_PRIVATE_KEY",
    "HOUDINI_X402_NETWORK",
    "HOUDINI_PARTNER_ID",
] as const;

const VALID_KEY = `0x${"a".repeat(64)}`;
// base58 of 64 bytes of 0x07 — shaped like a Phantom export.
const VALID_SVM_KEY = "99eUso3aSbE9tqGSTXzo3TLfKb9RkMTURrHKQ1K7Zh3BbeqPevr5E1iCbpTjqHuTFLtfxTTD5ekfVuZFzQyEQf8";

describe("getAuthConfig", () => {
    let originalEnv: Record<string, string | undefined>;

    beforeEach(() => {
        originalEnv = {};
        for (const key of AUTH_VARS) {
            originalEnv[key] = process.env[key];
            delete process.env[key];
        }
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        for (const key of AUTH_VARS) {
            if (originalEnv[key] === undefined) delete process.env[key];
            else process.env[key] = originalEnv[key];
        }
        vi.restoreAllMocks();
    });

    it("falls back to read-only when nothing is set", () => {
        expect(getAuthConfig()).toEqual({ type: "none" });
    });

    it("uses a well-formed x402 private key", () => {
        process.env.HOUDINI_X402_PRIVATE_KEY = VALID_KEY;
        expect(getAuthConfig()).toEqual({ type: "x402", privateKey: VALID_KEY });
    });

    it("accepts a bare 64-hex key and normalises it", () => {
        // What MetaMask's "Show private key" gives you — no 0x prefix.
        process.env.HOUDINI_X402_PRIVATE_KEY = "a".repeat(64);
        expect(getAuthConfig()).toEqual({ type: "x402", privateKey: VALID_KEY });
    });

    it("accepts uppercase and mixed-case hex", () => {
        process.env.HOUDINI_X402_PRIVATE_KEY = "AbCd".repeat(16);
        expect(getAuthConfig()).toEqual({
            type: "x402",
            privateKey: `0x${"AbCd".repeat(16)}`,
        });
    });

    it("does not warn when a bare key is accepted", () => {
        process.env.HOUDINI_X402_PRIVATE_KEY = "a".repeat(64);
        getAuthConfig();
        expect(console.error).not.toHaveBeenCalled();
    });

    it("ignores an unexpanded ${VAR} placeholder", () => {
        // What Claude Code passes when the plugin declares env passthrough and
        // the user never set the variable. Previously selected x402 mode and
        // crashed viem before the MCP transport connected.
        process.env.HOUDINI_X402_PRIVATE_KEY = "${HOUDINI_X402_PRIVATE_KEY}";
        expect(getAuthConfig()).toEqual({ type: "none" });
    });

    it("ignores the documented copy-paste placeholder", () => {
        process.env.HOUDINI_X402_PRIVATE_KEY = "0xYOUR_WALLET_PRIVATE_KEY";
        expect(getAuthConfig()).toEqual({ type: "none" });
    });

    it.each([
        ["too short", `0x${"a".repeat(63)}`],
        ["too long", `0x${"a".repeat(65)}`],
        ["bare hex, too short", "a".repeat(63)],
        ["bare hex, too long", "a".repeat(65)],
        ["non-hex characters", `0x${"z".repeat(64)}`],
        ["0x prefix only", "0x"],
        ["empty string", ""],
        ["whitespace only", "   "],
    ])("ignores a malformed key (%s)", (_label, value) => {
        process.env.HOUDINI_X402_PRIVATE_KEY = value;
        expect(getAuthConfig()).toEqual({ type: "none" });
    });

    it("warns on stderr when a key is present but malformed", () => {
        process.env.HOUDINI_X402_PRIVATE_KEY = "0xnope";
        getAuthConfig();
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining("read-only mode"),
        );
    });

    it("stays silent when no key was supplied at all", () => {
        getAuthConfig();
        expect(console.error).not.toHaveBeenCalled();
    });

    it("trims surrounding whitespace from a valid key", () => {
        process.env.HOUDINI_X402_PRIVATE_KEY = `  ${VALID_KEY}  `;
        expect(getAuthConfig()).toEqual({ type: "x402", privateKey: VALID_KEY });
    });

    it("prefers an API key over x402", () => {
        process.env.HOUDINI_API_KEY = "partner:secret";
        process.env.HOUDINI_X402_PRIVATE_KEY = VALID_KEY;
        expect(getAuthConfig()).toEqual({ type: "apiKey", key: "partner:secret" });
    });

    it("falls through to partner id when the x402 key is malformed", () => {
        process.env.HOUDINI_X402_PRIVATE_KEY = "${HOUDINI_X402_PRIVATE_KEY}";
        process.env.HOUDINI_PARTNER_ID = "some-partner";
        expect(getAuthConfig()).toEqual({ type: "partnerId", id: "some-partner" });
    });

    it("ignores placeholders in the other auth vars too", () => {
        process.env.HOUDINI_API_KEY = "${HOUDINI_API_KEY}";
        process.env.HOUDINI_PARTNER_ID = "${HOUDINI_PARTNER_ID}";
        expect(getAuthConfig()).toEqual({ type: "none" });
    });

    describe("Solana key", () => {
        it("uses a base58 Solana secret key on its own", () => {
            process.env.HOUDINI_X402_SVM_PRIVATE_KEY = VALID_SVM_KEY;
            expect(getAuthConfig()).toEqual({ type: "x402", svmPrivateKey: VALID_SVM_KEY });
        });

        it("uses both keys together", () => {
            process.env.HOUDINI_X402_PRIVATE_KEY = VALID_KEY;
            process.env.HOUDINI_X402_SVM_PRIVATE_KEY = VALID_SVM_KEY;
            expect(getAuthConfig()).toEqual({ type: "x402", privateKey: VALID_KEY, svmPrivateKey: VALID_SVM_KEY });
        });

        it("trims surrounding whitespace", () => {
            process.env.HOUDINI_X402_SVM_PRIVATE_KEY = `  ${VALID_SVM_KEY}  `;
            expect(getAuthConfig()).toEqual({ type: "x402", svmPrivateKey: VALID_SVM_KEY });
        });

        it.each([
            ["a 32-byte public key", "Bdg25JW8RBHKeq5YDWDrbH5Q2H8GaZFwqD6G4zPn2P2x"],
            ["an EVM key", VALID_KEY],
            ["characters outside base58", "0OIl".repeat(22)],
            ["the unexpanded placeholder", "${HOUDINI_X402_SVM_PRIVATE_KEY}"],
        ])("ignores %s", (_label, value) => {
            process.env.HOUDINI_X402_SVM_PRIVATE_KEY = value;
            expect(getAuthConfig()).toEqual({ type: "none" });
        });

        it("warns and goes read-only when the only key is a malformed Solana one", () => {
            process.env.HOUDINI_X402_SVM_PRIVATE_KEY = "not-a-key";
            getAuthConfig();
            expect(console.error).toHaveBeenCalledWith(expect.stringContaining("HOUDINI_X402_SVM_PRIVATE_KEY"));
            expect(console.error).toHaveBeenCalledWith(expect.stringContaining("read-only mode"));
        });

        it("keeps paying on Base when the Solana key is malformed", () => {
            process.env.HOUDINI_X402_PRIVATE_KEY = VALID_KEY;
            process.env.HOUDINI_X402_SVM_PRIVATE_KEY = "not-a-key";
            expect(getAuthConfig()).toEqual({ type: "x402", privateKey: VALID_KEY });
            expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("read-only mode"));
        });

        it("keeps paying on Solana when the EVM key is malformed", () => {
            process.env.HOUDINI_X402_PRIVATE_KEY = "0xnope";
            process.env.HOUDINI_X402_SVM_PRIVATE_KEY = VALID_SVM_KEY;
            expect(getAuthConfig()).toEqual({ type: "x402", svmPrivateKey: VALID_SVM_KEY });
            expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("read-only mode"));
        });

        it("still prefers an API key", () => {
            process.env.HOUDINI_API_KEY = "partner:secret";
            process.env.HOUDINI_X402_SVM_PRIVATE_KEY = VALID_SVM_KEY;
            expect(getAuthConfig()).toEqual({ type: "apiKey", key: "partner:secret" });
        });
    });

    describe("HOUDINI_X402_NETWORK", () => {
        const bothKeys = () => {
            process.env.HOUDINI_X402_PRIVATE_KEY = VALID_KEY;
            process.env.HOUDINI_X402_SVM_PRIVATE_KEY = VALID_SVM_KEY;
        };

        it.each([
            ["solana", "solana"],
            ["base", "base"],
            [" Solana ", "solana"],
            ["BASE", "base"],
        ])("passes %j through with both keys", (value, network) => {
            bothKeys();
            process.env.HOUDINI_X402_NETWORK = value;
            expect(getAuthConfig()).toEqual({ type: "x402", privateKey: VALID_KEY, svmPrivateKey: VALID_SVM_KEY, network });
            expect(console.error).not.toHaveBeenCalled();
        });

        it("warns about and ignores an unknown network", () => {
            bothKeys();
            process.env.HOUDINI_X402_NETWORK = "ethereum";
            expect(getAuthConfig()).toEqual({ type: "x402", privateKey: VALID_KEY, svmPrivateKey: VALID_SVM_KEY });
            expect(console.error).toHaveBeenCalledWith(expect.stringContaining("HOUDINI_X402_NETWORK"));
        });

        it.each([["empty", ""], ["the unexpanded placeholder", "${user_config.x402_network}"]])(
            "ignores it silently when %s",
            (_label, value) => {
                bothKeys();
                process.env.HOUDINI_X402_NETWORK = value;
                expect(getAuthConfig()).toEqual({ type: "x402", privateKey: VALID_KEY, svmPrivateKey: VALID_SVM_KEY });
                expect(console.error).not.toHaveBeenCalled();
            },
        );

        it("is left out with a single key, which pays regardless", () => {
            process.env.HOUDINI_X402_PRIVATE_KEY = VALID_KEY;
            process.env.HOUDINI_X402_NETWORK = "solana";
            expect(getAuthConfig()).toEqual({ type: "x402", privateKey: VALID_KEY });
        });
    });
});
