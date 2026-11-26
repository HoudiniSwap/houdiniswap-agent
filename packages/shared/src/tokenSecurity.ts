import type { Token, TokenSecurityScan } from "./types.js";

/**
 * The swap gate app.houdini.com applies to a token security verdict, for the
 * tools that create an order in the same call as the quote (`swap`). The site
 * stops the swap behind a popup and goes on only once the user accepts:
 *
 * - `Malicious` always stops it; the user must tick "I understand and accept
 *   the risk involved".
 * - `Warning` stops it only when the scan found one of the features below;
 *   any other Warning passes without a popup.
 * - `Unscanned` and `Benign` pass.
 *
 * Keep the lists in step with the site (features/swap/constants/token-security.ts).
 */

/** The findings the site shows, most severe first, with the site's own labels. */
const SHOWN_FEATURES: ReadonlyArray<readonly [id: string, label: string]> = [
    ["HONEYPOT", "Honeypot risk"],
    ["IMPERSONATOR_HIGH_CONFIDENCE", "Impersonates other token"],
    ["IMPERSONATOR", "Impersonates other token"],
    ["EXIT_SCAM_RISK", "High risk of exit scam"],
    ["FREEZE_INSTRUCTION_TRIGGERED", "Freeze instruction triggered"],
    ["LIQUIDITY_UNLOCK_ON_MIGRATION", "Liquidity unlocks on migration"],
    ["INSUFFICIENT_LOCKED_LIQUIDITY", "Insufficient locked liquidity"],
    ["SUSPICIOUS_FUND_TRAIL", "Suspicious fund trail"],
    ["DYNAMIC_ANALYSIS", "Suspicious contract behavior detected"],
    ["HIDDEN_SUPPLY_BY_KEY_HOLDER", "Hidden supply held by key holder"],
    ["CONCENTRATED_SUPPLY_DISTRIBUTION", "Supply concentrated in few wallets"],
    ["IMPERSONATOR_MEDIUM_CONFIDENCE", "Possibly impersonates other token"],
    ["SNIPE_AT_MINT", "Sniped at mint"],
    ["UNSTABLE_TOKEN_PRICE", "Unstable token price"],
    ["LOW_REPUTATION_CREATOR", "Created by low-reputation creator"],
];

/** The site shows at most this many findings. */
const MAX_FLAGS = 3;

// The site's own wording for both verdicts.
const RISK_DESCRIPTION =
    "This means that this token may be related to a scam or harmful activity. Examples of potentially harmful activity could include tokens that redirect users to phishing websites, have malicious smart contract code, or are part of a known scam operation.";

export type TokenSecurityVariant = "malicious" | "warning";

export interface TokenSecurityDisplay {
    variant: TokenSecurityVariant;
    /** Labels of the findings the site would list, most severe first. */
    flags: string[];
}

export interface FlaggedToken {
    tokenId: string;
    /** "SYMBOL on chain", as the caller named it. */
    token: string;
    variant: TokenSecurityVariant;
    flags: string[];
    /** The site's popup text for this token. */
    warning: string;
}

export interface SwapTokenCheck {
    token: Token;
    /** `fromTokenScan` / `toTokenScan` from the quote, if any. */
    quoteScan?: TokenSecurityScan | unknown;
    /** How to name the token to the user, e.g. "ETH on ethereum". */
    label: string;
}

const resultTypeOf = (scan: unknown): string | undefined => {
    const resultType = (scan as { resultType?: unknown } | undefined)?.resultType;
    return typeof resultType === "string" ? resultType.toLowerCase() : undefined;
};

/**
 * What the site's popup shows for one verdict, or null when it shows none.
 * Mirrors getTokenSecurityDisplay on app.houdini.com.
 */
export const tokenSecurityDisplay = (scan: unknown): TokenSecurityDisplay | null => {
    const resultType = resultTypeOf(scan);
    const malicious = resultType === "malicious";
    if (!malicious && resultType !== "warning") return null;

    const found = new Set<string>();
    const features = (scan as { features?: unknown }).features;
    if (Array.isArray(features)) {
        for (const f of features) {
            const id = (f as { featureId?: unknown } | null)?.featureId;
            if (typeof id === "string") found.add(id);
        }
    }
    // Confidence variants of one finding (IMPERSONATOR, IMPERSONATOR_HIGH_CONFIDENCE…)
    // share one slot, shown as the most severe of them.
    const groups = new Set<string>();
    const flags: string[] = [];
    for (const [id, label] of SHOWN_FEATURES) {
        if (!found.has(id)) continue;
        const group = id.replace(/_(HIGH|MEDIUM|LOW)_CONFIDENCE$/, "");
        if (groups.has(group)) continue;
        groups.add(group);
        flags.push(label);
    }
    flags.splice(MAX_FLAGS);

    if (!malicious && flags.length === 0) return null;
    return { variant: malicious ? "malicious" : "warning", flags };
};

/**
 * The quote's verdict is screened for this swap, so it decides. The verdict
 * stored on the token counts only where the quote has none or a temporary
 * "Unscanned" (the screen timed out), and a stored Malicious always counts: an
 * Unscanned or a missing quote verdict must not hide it.
 */
const swapDisplay = (quoteScan: unknown, token: Token): TokenSecurityDisplay | null => {
    const fromQuote = tokenSecurityDisplay(quoteScan);
    const stored = tokenSecurityDisplay(token.securityScan);
    if (fromQuote?.variant === "malicious") return fromQuote;
    if (stored?.variant === "malicious") return stored;
    const quoteType = resultTypeOf(quoteScan);
    const quoteScreened = quoteType !== undefined && quoteType !== "unscanned";
    return quoteScreened ? fromQuote : stored;
};

const warningText = (label: string, display: TokenSecurityDisplay): string => {
    const title = display.flags[0] ?? (display.variant === "malicious" ? "Malicious token detected" : "Warning detected");
    const verdict = display.variant === "malicious" ? "malicious" : "suspicious";
    const more = display.flags.length > 1 ? ` Also found: ${display.flags.slice(1).join(", ")}.` : "";
    return `${title}: ${label} has been flagged as ${verdict} by a token security scan. ${RISK_DESCRIPTION}${more}`;
};

/**
 * The swap tokens the site would stop behind its popup. A token whose id is in
 * `acceptedTokenIds` is still listed in `flagged` but not in `unaccepted`.
 */
export const checkSwapTokens = (
    tokens: SwapTokenCheck[],
    acceptedTokenIds: readonly string[] = [],
): { flagged: FlaggedToken[]; unaccepted: FlaggedToken[] } => {
    const flagged: FlaggedToken[] = [];
    for (const { token, quoteScan, label } of tokens) {
        const display = swapDisplay(quoteScan, token);
        if (!display) continue;
        flagged.push({
            tokenId: token.id,
            token: label,
            variant: display.variant,
            flags: display.flags,
            warning: warningText(label, display),
        });
    }
    const accepted = new Set(acceptedTokenIds);
    return { flagged, unaccepted: flagged.filter(f => !accepted.has(f.tokenId)) };
};

/**
 * The answer a `swap` tool gives instead of an order while a flagged token is
 * not accepted: the site's warning, and how to go on if the user accepts.
 */
export const swapRiskConfirmation = (unaccepted: FlaggedToken[]) => ({
    error:
        `No order created: ${unaccepted.map(f => f.token).join(" and ")} ${unaccepted.length > 1 ? "were" : "was"} flagged by a token security scan. ` +
        "Show the user each warning below and ask whether they accept the risk. " +
        "Only if they explicitly accept it, call swap again with the same arguments and acceptRiskTokenIds set to the ids below. " +
        "If they do not, create no order.",
    confirmationRequired: true,
    acceptRiskTokenIds: unaccepted.map(f => f.tokenId),
    flaggedTokens: unaccepted.map(({ tokenId, token, variant, flags, warning }) => ({ tokenId, token, variant, flags, warning })),
});

/** What the `acceptRiskTokenIds` argument of a `swap` tool says to the model. */
export const ACCEPT_RISK_DESCRIPTION =
    "Only after this tool returned confirmationRequired and the user explicitly accepted the risk: the acceptRiskTokenIds it returned. Never set this on a first call or without the user's answer.";
