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
    // Safety-critical: the skill requires the agent to warn before swapping an
    // unverified token, which it cannot do if this is stripped. Absent on
    // verified tokens, so it costs nothing on the common path.
    "unverified",
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

const CHAIN_KEYS = [
    "id",
    "name",
    "shortName",
    "kind",
    "chainId",
    "memoNeeded",
    "hasCex",
    "hasDex",
] as const;

/**
 * Drops `icon`, the two address-validation regexes, `priority`, and the
 * explorer/address URL templates. The URL templates alone are ~5.8 KB across a
 * 100-chain page, and an agent needs them for at most one chain — narrow with
 * `getChains({ name })` or pass `verbose: true` to get them back.
 */
export const compactChain = (chain: unknown): unknown => {
    if (!chain || typeof chain !== "object") return chain;
    return pick(chain as Json, CHAIN_KEYS);
};

/** Preserves `total`/`totalPages` so a truncated page stays visible. */
export const compactChainResult = (result: unknown): unknown => {
    if (!result || typeof result !== "object") return result;
    const source = result as Json;
    if (!Array.isArray(source.chains)) return result;
    return { ...source, chains: (source.chains as unknown[]).map(compactChain) };
};

const PROVIDER_KEYS = ["name", "shortName", "enabled", "isDex", "deprecated"] as const;

const compactProvider = (provider: unknown): unknown =>
    provider && typeof provider === "object" ? pick(provider as Json, PROVIDER_KEYS) : provider;

/**
 * Drops `id`, `txUrl`, `logoUrl` and the markup/slippage capability flags;
 * `shortName` is what the `swaps` quote filter takes.
 *
 * `GET /swaps` answers with a bare array, not `{ swaps: [...] }`. Both are
 * handled — an object-only guard here silently returned the payload unshaped.
 */
export const compactProviderResult = (result: unknown): unknown => {
    if (Array.isArray(result)) return result.map(compactProvider);
    if (!result || typeof result !== "object") return result;
    const source = result as Json;
    if (!Array.isArray(source.swaps)) return result;
    return { ...source, swaps: (source.swaps as unknown[]).map(compactProvider) };
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
 *
 * `requestedSwaps` is re-checked here even though the API applies it too. During
 * a live swap, a `swaps: ["su"]` request came back led by PancakeSwap: an older
 * server build had no `swaps` parameter and dropped it before it reached the
 * API. Anything that silently loses the filter — version skew, a proxy, a future
 * regression — otherwise ends with an order at the wrong provider, which is not
 * recoverable. The check costs one array scan and reports when it had to act.
 */
export const compactQuoteResult = (
    result: unknown,
    limitPerType: number,
    requestedSwaps?: string[],
): unknown => {
    if (!result || typeof result !== "object") return result;
    const source = result as Json;
    const rawQuotes = source.quotes;
    if (!Array.isArray(rawQuotes)) return result;

    let quotes = rawQuotes as Json[];
    let filteredClientSide = false;
    if (requestedSwaps?.length) {
        const wanted = new Set(requestedSwaps);
        const matching = quotes.filter((q) => typeof q.swap === "string" && wanted.has(q.swap));
        if (matching.length !== quotes.length) {
            filteredClientSide = true;
            quotes = matching;
        }
    }

    const seenPerType = new Map<string, number>();
    const kept: Json[] = [];
    for (const quote of quotes) {
        const type = typeof quote?.type === "string" ? quote.type : "unknown";
        const count = seenPerType.get(type) ?? 0;
        if (count >= limitPerType) continue;
        seenPerType.set(type, count + 1);
        kept.push(compactQuote(quote));
    }

    return {
        total: source.total ?? rawQuotes.length,
        returned: kept.length,
        omitted: quotes.length - kept.length,
        limitPerType,
        ...(filteredClientSide
            ? {
                  swapsFilteredClientSide: true,
                  requestedSwaps,
                  note: "The API ignored the `swaps` filter (it does so for DEX quotes); it was applied here instead.",
              }
            : {}),
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
