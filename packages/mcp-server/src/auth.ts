import { isSvmSecretKey, type HoudiniAuth } from "@houdiniswap/agent-shared";

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
    const svmKey = readEnv("HOUDINI_X402_SVM_PRIVATE_KEY");
    const partnerId = readEnv("HOUDINI_PARTNER_ID");

    if (apiKey) return { type: "apiKey", key: apiKey };

    const evm = x402Key && PRIVATE_KEY_PATTERN.test(x402Key)
        ? (x402Key.startsWith("0x") ? x402Key : `0x${x402Key}`) as `0x${string}`
        : undefined;
    const svm = svmKey && isSvmSecretKey(svmKey) ? svmKey : undefined;

    // A malformed key would throw inside the signer before the transport is
    // connected, which surfaces to the client as an unexplained "Connection
    // closed". Dropping it is the useful fallback.
    if (x402Key && !evm) {
        console.error(
            "HOUDINI_X402_PRIVATE_KEY is not a 0x-prefixed 32-byte hex key — ignoring it" +
                (svm ? "." : " and starting in read-only mode."),
        );
    }
    if (svmKey && !svm) {
        console.error(
            "HOUDINI_X402_SVM_PRIVATE_KEY is not a base58 Solana secret key (64 bytes) — ignoring it" +
                (evm ? "." : " and starting in read-only mode."),
        );
    }

    if (evm && svm) return { type: "x402", privateKey: evm, svmPrivateKey: svm };
    if (evm) return { type: "x402", privateKey: evm };
    if (svm) return { type: "x402", svmPrivateKey: svm };

    if (partnerId) return { type: "partnerId", id: partnerId };
    return { type: "none" };
};
