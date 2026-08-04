import type { HoudiniAuth } from "@houdiniswap/agent-shared";

// MetaMask's "Show private key" exports 64 bare hex characters with no 0x, and
// that is how most people obtain a key. Accept both and normalise.
const PRIVATE_KEY_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/;
const UNEXPANDED_PLACEHOLDER = /^\$\{.*\}$/;

/**
 * MCP clients substitute `${VAR}` in server configs. When the variable is unset
 * the placeholder is handed to us verbatim, so an empty config reads as a
 * credential unless we filter it out here.
 */
const readEnv = (name: string): string | undefined => {
    const value = process.env[name]?.trim();
    if (!value || UNEXPANDED_PLACEHOLDER.test(value)) return undefined;
    return value;
};

export const getAuthConfig = (): HoudiniAuth => {
    const apiKey = readEnv("HOUDINI_API_KEY");
    const x402Key = readEnv("HOUDINI_X402_PRIVATE_KEY");
    const partnerId = readEnv("HOUDINI_PARTNER_ID");

    if (apiKey) return { type: "apiKey", key: apiKey };

    if (x402Key) {
        if (PRIVATE_KEY_PATTERN.test(x402Key)) {
            const normalised = x402Key.startsWith("0x") ? x402Key : `0x${x402Key}`;
            return { type: "x402", privateKey: normalised as `0x${string}` };
        }
        // A malformed key would throw inside viem before the transport is
        // connected, which surfaces to the client as an unexplained
        // "Connection closed". Read-only mode is the useful fallback.
        console.error(
            "HOUDINI_X402_PRIVATE_KEY is not a 0x-prefixed 32-byte hex key — ignoring it and starting in read-only mode.",
        );
    }

    if (partnerId) return { type: "partnerId", id: partnerId };
    return { type: "none" };
};
