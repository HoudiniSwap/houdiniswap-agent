import {
    isSvmSecretKey,
    isX402Network,
    type HoudiniAuth,
    type HoudiniConfig,
    type X402Network,
} from "@houdiniswap/agent-shared";

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
    const networkName = readEnv("HOUDINI_X402_NETWORK")?.toLowerCase();
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

    // Only matters with both keys; with one, that wallet pays regardless.
    let network: X402Network | undefined;
    if (networkName && evm && svm) {
        if (isX402Network(networkName)) network = networkName;
        else console.error(`HOUDINI_X402_NETWORK must be "base" or "solana" — ignoring "${networkName}", Base is tried first.`);
    }

    if (evm && svm) return { type: "x402", privateKey: evm, svmPrivateKey: svm, ...(network && { network }) };
    if (evm) return { type: "x402", privateKey: evm };
    if (svm) return { type: "x402", svmPrivateKey: svm };

    if (partnerId) return { type: "partnerId", id: partnerId };
    return { type: "none" };
};

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const USDC_AMOUNT = /^(\d+)(?:\.(\d{1,6}))?$/;

/** A comma-separated list of addresses, or undefined (with a warning) when any entry is malformed. */
const readAddresses = (name: string, pattern: RegExp): string[] | undefined => {
    const value = readEnv(name);
    if (!value) return undefined;
    const addresses = value.split(",").map((a) => a.trim()).filter(Boolean);
    const bad = addresses.filter((a) => !pattern.test(a));
    if (addresses.length === 0 || bad.length > 0) {
        console.error(`${name} has a malformed address (${bad.join(", ") || "empty"}) — ignoring it; the production recipients apply.`);
        return undefined;
    }
    return addresses;
};

/**
 * Who x402 may pay and how much in total, from the environment.
 *
 * HOUDINI_X402_PAY_TO_BASE / HOUDINI_X402_PAY_TO_SOLANA replace the production
 * recipients for a network (comma-separated, for another HoudiniSwap
 * environment or a wallet change). HOUDINI_X402_BUDGET_USDC caps what one
 * server process signs, in USDC (default 10).
 */
export const getX402Policy = (): NonNullable<HoudiniConfig["x402"]> => {
    const policy: NonNullable<HoudiniConfig["x402"]> = {};

    const base = readAddresses("HOUDINI_X402_PAY_TO_BASE", EVM_ADDRESS);
    const solana = readAddresses("HOUDINI_X402_PAY_TO_SOLANA", SOLANA_ADDRESS);
    if (base || solana) policy.payTo = { ...(base && { base }), ...(solana && { solana }) };

    const budget = readEnv("HOUDINI_X402_BUDGET_USDC");
    if (budget) {
        const match = USDC_AMOUNT.exec(budget);
        if (match) {
            policy.budgetAtomic = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
        } else {
            console.error(`HOUDINI_X402_BUDGET_USDC must be an amount in USDC such as "10" or "2.5" — ignoring "${budget}", the limit is 10 USDC.`);
        }
    }

    return policy;
};
