/**
 * The partner API returns rows built for a web UI: multi-paragraph token
 * descriptions, icon URLs, embedded chain records, and every quote a provider
 * offered. An agent pays for all of it in context — a single unfiltered
 * getQuote for ETH->SOL returns 145 quotes, and createExchange embeds the full
 * prose description of both chains.
 *
 * These helpers keep the fields an agent acts on and drop the rest. Every tool
 * that uses them also accepts `verbose: true` to return the API response
 * untouched, so nothing is permanently out of reach.
 */

type Json = Record<string, unknown>;

const pick = (source: Json, keys: readonly string[]): Json => {
    const out: Json = {};
    for (const key of keys) {
        if (source[key] !== undefined && source[key] !== null) out[key] = source[key];
    }
    return out;
};

const TOKEN_KEYS = [
    "id",
    "symbol",
    "name",
    "chain",
    "address",
    "decimals",
    "mainnet",
    "hasCex",
    "hasDex",
    "hasSelfPrivate",
    "price",
] as const;

/** Drops `description`, `icon`, `chainData` and market-cap noise; keeps `chainId`. */
export const compactToken = (token: unknown): unknown => {
    if (!token || typeof token !== "object") return token;
    const source = token as Json;
    const out = pick(source, TOKEN_KEYS);
    const chainData = source.chainData as Json | undefined;
    if (chainData?.chainId !== undefined) out.chainId = chainData.chainId;
    return out;
};

const QUOTE_KEYS = [
    "quoteId",
    "swap",
    "swapName",
    "type",
    "amountIn",
    "amountOut",
    "amountOutUsd",
    "netAmountOut",
    "duration",
    "gas",
    "min",
    "max",
    "rewardsAvailable",
    "requiresApproval",
    "error",
] as const;

const compactQuote = (quote: Json): Json => pick(quote, QUOTE_KEYS);

/**
 * Keeps the best `limitPerType` quotes of each type, preserving the order the
 * API returned (already sorted by the caller's `sort`/`sortOrder`). Reports what
 * it dropped rather than silently truncating.
 */
export const compactQuoteResult = (
    result: unknown,
    limitPerType: number,
): unknown => {
    if (!result || typeof result !== "object") return result;
    const source = result as Json;
    const quotes = source.quotes;
    if (!Array.isArray(quotes)) return result;

    const seenPerType = new Map<string, number>();
    const kept: Json[] = [];
    for (const quote of quotes as Json[]) {
        const type = typeof quote?.type === "string" ? quote.type : "unknown";
        const count = seenPerType.get(type) ?? 0;
        if (count >= limitPerType) continue;
        seenPerType.set(type, count + 1);
        kept.push(compactQuote(quote));
    }

    return {
        total: source.total ?? quotes.length,
        returned: kept.length,
        omitted: quotes.length - kept.length,
        limitPerType,
        quotes: kept,
    };
};

/** Replaces the embedded `inToken`/`outToken` documents with compact ones. */
export const compactOrder = (order: unknown): unknown => {
    if (!order || typeof order !== "object") return order;
    const source = { ...(order as Json) };
    if (source.inToken) source.inToken = compactToken(source.inToken);
    if (source.outToken) source.outToken = compactToken(source.outToken);
    return source;
};

export const compactTokenResult = (result: unknown): unknown => {
    if (!result || typeof result !== "object") return result;
    const source = result as Json;
    if (!Array.isArray(source.tokens)) return result;
    return { ...source, tokens: (source.tokens as unknown[]).map(compactToken) };
};

export const compactOrderList = (result: unknown): unknown => {
    if (!result || typeof result !== "object") return result;
    const source = result as Json;
    if (!Array.isArray(source.orders)) return result;
    return { ...source, orders: (source.orders as unknown[]).map(compactOrder) };
};

/** MCP payloads are machine-read; indentation is pure token cost. */
export const asToolResult = (payload: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
});
