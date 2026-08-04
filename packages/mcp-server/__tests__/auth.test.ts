import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getAuthConfig } from "../src/auth.js";

const AUTH_VARS = [
    "HOUDINI_API_KEY",
    "HOUDINI_X402_PRIVATE_KEY",
    "HOUDINI_PARTNER_ID",
] as const;

const VALID_KEY = `0x${"a".repeat(64)}`;

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
        ["missing 0x prefix", "a".repeat(64)],
        ["non-hex characters", `0x${"z".repeat(64)}`],
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
});
