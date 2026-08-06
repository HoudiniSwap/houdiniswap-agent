import { describe, it, expect } from "vitest";
import {
    compactToken,
    compactChain,
    compactChainResult,
    compactProviderResult,
    compactQuoteResult,
    compactOrder,
    compactTokenResult,
    compactOrderList,
    asToolResult,
} from "../src/shape.js";

const token = {
    id: "6689b73ec90e45f3b3e51566",
    symbol: "ETH",
    name: "Ethereum",
    chain: "ethereum",
    address: null,
    decimals: 18,
    mainnet: true,
    hasCex: true,
    hasDex: true,
    hasSelfPrivate: true,
    price: 1865.01,
    description: "Ethereum is a global, open-source platform ...".repeat(20),
    icon: "https://api.houdiniswap.com/assets/tokens/ETH-ETH-lejbdy.png",
    cexTokenId: "ETH",
    marketCap: 224731582752,
    volume: 6979025899,
    circulatingSupply: 120682209.8895669,
    chainData: { name: "Ethereum Mainnet", chainId: 1, icon: "…", description: "…" },
};

const quote = (type: string, amountOut: number) => ({
    quoteId: `q-${type}-${amountOut}`,
    swap: "nx",
    swapName: "Nexchange",
    type,
    amountIn: 0.5,
    amountOut,
    amountOutUsd: amountOut * 73.6,
    duration: 6,
    logoUrl: "https://api.houdiniswap.com/assets/logos/nexchange-eu55lk.png",
    rewardsAvailable: true,
});

describe("compactToken", () => {
    it("keeps the fields an agent acts on", () => {
        const out = compactToken(token) as Record<string, unknown>;
        expect(out.id).toBe(token.id);
        expect(out.symbol).toBe("ETH");
        expect(out.chain).toBe("ethereum");
        expect(out.decimals).toBe(18);
        expect(out.price).toBe(1865.01);
        expect(out.hasDex).toBe(true);
    });

    // The skill requires the agent to warn before swapping an unverified token.
    // Stripping this field silently disabled that warning — a scam-token guard
    // that could never fire. Caught by diffing raw vs shaped fields against the
    // field names the skill actually references.
    it("keeps `unverified`, which the scam-token warning depends on", () => {
        const flagged = { ...token, unverified: true };
        expect((compactToken(flagged) as Record<string, unknown>).unverified).toBe(true);
    });

    it("keeps `unverified` through a token list too", () => {
        const out = compactTokenResult({ total: 1, tokens: [{ ...token, unverified: true }] }) as any;
        expect(out.tokens[0].unverified).toBe(true);
    });

    it("drops description, icon and market noise", () => {
        const out = compactToken(token) as Record<string, unknown>;
        expect(out.description).toBeUndefined();
        expect(out.icon).toBeUndefined();
        expect(out.marketCap).toBeUndefined();
        expect(out.volume).toBeUndefined();
        expect(out.circulatingSupply).toBeUndefined();
        expect(out.chainData).toBeUndefined();
    });

    it("lifts chainId out of chainData", () => {
        expect((compactToken(token) as Record<string, unknown>).chainId).toBe(1);
    });

    it("is dramatically smaller than the original", () => {
        const before = JSON.stringify(token).length;
        const after = JSON.stringify(compactToken(token)).length;
        expect(after).toBeLessThan(before / 4);
    });

    it("passes through non-objects untouched", () => {
        expect(compactToken(null)).toBeNull();
        expect(compactToken("nope")).toBe("nope");
    });
});

// Field-for-field copy of a row from a live GET /chains page.
const chain = {
    id: "68df742d6436a987148301e4",
    name: "Bittensor evm",
    shortName: "TAO",
    memoNeeded: false,
    explorerUrl: "https://evm.taostats.io/tx/{txHash}",
    addressUrl: "https://evm.taostats.io/address/{address}",
    icon: "https://api.houdiniswap.com/assets/chains/TAO-qj6qf1.png",
    kind: "evm",
    addressValidation: "^(0x)[0-9A-Fa-f]{40}$",
    tokenAddressValidation: "^(0x)[0-9A-Fa-f]{40}$",
    chainId: 964,
    priority: 12,
};

describe("compactChain", () => {
    it("keeps what an agent needs to pick a chain", () => {
        const out = compactChain(chain) as Record<string, unknown>;
        expect(out.id).toBe(chain.id);
        expect(out.name).toBe("Bittensor evm");
        expect(out.shortName).toBe("TAO");
        expect(out.kind).toBe("evm");
        expect(out.chainId).toBe(964);
        expect(out.memoNeeded).toBe(false);
    });

    it("drops icons, URL templates and validation regexes", () => {
        const out = compactChain(chain) as Record<string, unknown>;
        expect(out.icon).toBeUndefined();
        expect(out.explorerUrl).toBeUndefined();
        expect(out.addressUrl).toBeUndefined();
        expect(out.addressValidation).toBeUndefined();
        expect(out.tokenAddressValidation).toBeUndefined();
        expect(out.priority).toBeUndefined();
    });

    it("passes through non-objects untouched", () => {
        expect(compactChain(null)).toBeNull();
        expect(compactChain(7)).toBe(7);
    });
});

describe("compactChainResult", () => {
    // The unshaped 100-chain page was 50,946 characters, which overran the MCP
    // tool-result limit outright — getChains returned nothing usable.
    const page = { chains: Array.from({ length: 100 }, () => chain), totalPages: 2, total: 130 };

    it("keeps pagination visible so a truncated page is obvious", () => {
        const out = compactChainResult(page) as any;
        expect(out.total).toBe(130);
        expect(out.totalPages).toBe(2);
        expect(out.chains).toHaveLength(100);
    });

    it("compacts every chain in the page", () => {
        const out = compactChainResult(page) as any;
        for (const c of out.chains) expect(c.icon).toBeUndefined();
    });

    it("brings a full page back under the tool-result limit", () => {
        const before = JSON.stringify(page).length;
        const after = JSON.stringify(compactChainResult(page)).length;
        expect(after).toBeLessThan(before / 2);
    });

    it("passes through a response with no chains array", () => {
        const weird = { error: "nope" };
        expect(compactChainResult(weird)).toBe(weird);
    });
});

describe("compactProviderResult", () => {
    // GET /swaps answers with a BARE ARRAY. An earlier version of this helper
    // only unwrapped `{ swaps: [...] }`, so it fell straight through and shipped
    // every logoUrl unshaped — caught by driving the real API, not a fixture.
    const providers = [
        {
            id: "6421c1bb38a32da00696b9bc",
            name: "ChangeNow",
            shortName: "cn",
            txUrl: "https://changenow.io/exchange/txs/",
            enabled: true,
            isDex: false,
            deprecated: false,
            markupSupported: false,
            slippageSupported: false,
            logoUrl: "https://api.houdiniswap.com/assets/logos/changenow.png",
            autoSlippageSupported: false,
        },
        {
            id: "6421c1bb38a32da00696b9bd",
            name: "Uniswap",
            shortName: "uni",
            enabled: false,
            isDex: true,
            deprecated: true,
            logoUrl: "https://api.houdiniswap.com/assets/logos/uniswap.png",
        },
    ];

    it("shapes a bare array, the shape the API actually returns", () => {
        const out = compactProviderResult(providers) as any[];
        expect(Array.isArray(out)).toBe(true);
        expect(out.map((s) => s.shortName)).toEqual(["cn", "uni"]);
    });

    it("keeps false-valued flags rather than dropping them as falsy", () => {
        const out = compactProviderResult(providers) as any[];
        expect(out[0].enabled).toBe(true);
        expect(out[0].isDex).toBe(false);
        expect(out[1].enabled).toBe(false);
        expect(out[1].deprecated).toBe(true);
    });

    it("drops logoUrl, txUrl, id and the capability flags", () => {
        const out = compactProviderResult(providers) as any[];
        for (const s of out) {
            expect(s.logoUrl).toBeUndefined();
            expect(s.txUrl).toBeUndefined();
            expect(s.id).toBeUndefined();
            expect(s.markupSupported).toBeUndefined();
            expect(s.autoSlippageSupported).toBeUndefined();
        }
    });

    it("also handles a { swaps: [...] } wrapper, should the API ever add one", () => {
        const out = compactProviderResult({ swaps: providers, total: 2 }) as any;
        expect(out.total).toBe(2);
        expect(out.swaps[0].logoUrl).toBeUndefined();
    });

    it("passes through a response that is neither", () => {
        const weird = { error: "nope" };
        expect(compactProviderResult(weird)).toBe(weird);
    });
});

describe("compactQuoteResult", () => {
    const result = {
        total: 145,
        quotes: [
            ...Array.from({ length: 7 }, (_, i) => quote("standard", 12.6 - i * 0.01)),
            ...Array.from({ length: 138 }, (_, i) => quote("private", 12.5 - i * 0.001)),
        ],
    };

    it("keeps the best N of each type", () => {
        const out = compactQuoteResult(result, 5) as any;
        const types = out.quotes.map((q: any) => q.type);
        expect(types.filter((t: string) => t === "standard")).toHaveLength(5);
        expect(types.filter((t: string) => t === "private")).toHaveLength(5);
    });

    it("preserves the order the API returned, so the best survive", () => {
        const out = compactQuoteResult(result, 3) as any;
        const standard = out.quotes.filter((q: any) => q.type === "standard");
        expect(standard[0].amountOut).toBe(12.6);
        expect(standard[0].amountOut).toBeGreaterThan(standard[2].amountOut);
    });

    it("reports what it dropped instead of truncating silently", () => {
        const out = compactQuoteResult(result, 5) as any;
        expect(out.total).toBe(145);
        expect(out.returned).toBe(10);
        expect(out.omitted).toBe(135);
        expect(out.limitPerType).toBe(5);
    });

    it("strips logoUrl from each quote", () => {
        const out = compactQuoteResult(result, 2) as any;
        for (const q of out.quotes) expect(q.logoUrl).toBeUndefined();
    });

    it("keeps everything when the list is under the limit", () => {
        const small = { total: 2, quotes: [quote("standard", 1), quote("dex", 2)] };
        const out = compactQuoteResult(small, 5) as any;
        expect(out.returned).toBe(2);
        expect(out.omitted).toBe(0);
    });

    it("passes through a response with no quotes array", () => {
        const weird = { error: "nope" };
        expect(compactQuoteResult(weird, 5)).toBe(weird);
    });

    // The API does apply `swaps`. This is defence against anything that loses it
    // in transit: during a live swap a `["su"]` request came back led by
    // PancakeSwap, because an older server build had no `swaps` parameter and
    // dropped it. Ordering from the wrong provider is not recoverable.
    describe("swaps filter", () => {
        const mixed = {
            total: 4,
            quotes: [
                { ...quote("dex", 9), swap: "ps", swapName: "PancakeSwap" },
                { ...quote("dex", 8), swap: "su", swapName: "SushiSwap" },
                { ...quote("dex", 7), swap: "un", swapName: "Uniswap" },
                { ...quote("dex", 6), swap: "su", swapName: "SushiSwap" },
            ],
        };

        it("enforces the filter when the API ignored it", () => {
            const out = compactQuoteResult(mixed, 5, ["su"]) as any;
            expect(out.quotes).toHaveLength(2);
            expect(out.quotes.every((q: any) => q.swap === "su")).toBe(true);
            expect(out.swapsFilteredClientSide).toBe(true);
            expect(out.requestedSwaps).toEqual(["su"]);
        });

        it("keeps the API's own total so the discrepancy stays visible", () => {
            const out = compactQuoteResult(mixed, 5, ["su"]) as any;
            expect(out.total).toBe(4);
            expect(out.returned).toBe(2);
        });

        it("stays quiet when the API honoured the filter", () => {
            const honoured = { total: 2, quotes: [mixed.quotes[1], mixed.quotes[3]] };
            const out = compactQuoteResult(honoured, 5, ["su"]) as any;
            expect(out.swapsFilteredClientSide).toBeUndefined();
            expect(out.note).toBeUndefined();
            expect(out.quotes).toHaveLength(2);
        });

        it("does nothing when no filter was requested", () => {
            const out = compactQuoteResult(mixed, 5) as any;
            expect(out.quotes).toHaveLength(4);
            expect(out.swapsFilteredClientSide).toBeUndefined();
        });

        it("returns an empty set rather than the wrong provider", () => {
            const out = compactQuoteResult(mixed, 5, ["nonexistent"]) as any;
            expect(out.quotes).toHaveLength(0);
            expect(out.swapsFilteredClientSide).toBe(true);
        });
    });

    it("cuts a realistic payload by an order of magnitude", () => {
        const before = JSON.stringify(result).length;
        const after = JSON.stringify(compactQuoteResult(result, 5)).length;
        expect(after).toBeLessThan(before / 10);
    });
});

describe("compactOrder", () => {
    const order = {
        houdiniId: "4BigXnq4t6Y3i2mMKNWdxx",
        depositAddress: "0xc5830704DeE31AC9856346AaCED1e93F13949632",
        status: 0,
        displayStatus: "WAITING_FOR_DEPOSIT",
        inAmount: 0.5,
        outAmount: 12.577,
        isX402: true,
        inToken: token,
        outToken: token,
    };

    it("keeps the operational fields", () => {
        const out = compactOrder(order) as any;
        expect(out.houdiniId).toBe(order.houdiniId);
        expect(out.depositAddress).toBe(order.depositAddress);
        expect(out.displayStatus).toBe("WAITING_FOR_DEPOSIT");
        expect(out.isX402).toBe(true);
    });

    it("compacts both embedded tokens", () => {
        const out = compactOrder(order) as any;
        expect(out.inToken.description).toBeUndefined();
        expect(out.outToken.description).toBeUndefined();
        expect(out.inToken.symbol).toBe("ETH");
    });

    it("does not mutate the input", () => {
        compactOrder(order);
        expect((order.inToken as any).description).toBeDefined();
    });
});

describe("list helpers", () => {
    it("compacts every token in a token result", () => {
        const out = compactTokenResult({ total: 1, tokens: [token] }) as any;
        expect(out.total).toBe(1);
        expect(out.tokens[0].description).toBeUndefined();
    });

    it("compacts every order in an order list", () => {
        const out = compactOrderList({
            totalPages: 1,
            orders: [{ houdiniId: "x", inToken: token }],
        }) as any;
        expect(out.orders[0].inToken.description).toBeUndefined();
    });
});

describe("asToolResult", () => {
    it("emits compact JSON, not pretty-printed", () => {
        const text = asToolResult({ a: 1, b: 2 }).content[0].text;
        expect(text).toBe('{"a":1,"b":2}');
        expect(text).not.toContain("\n");
    });
});

describe("private quotes and the swaps re-filter", () => {
    // Private (anonymous 2-hop) quotes carry no `swap`/`swapName` — the API
    // strips provider identity deliberately, because naming the hops would undo
    // the privacy. Matching on `swap` deleted every private route whenever a
    // swaps filter was passed, then blamed the API for ignoring the filter.
    const mixed = {
        total: 4,
        quotes: [
            { quoteId: "a", type: "standard", swap: "cn", swapName: "ChangeNow", amountOut: 9 },
            { quoteId: "b", type: "standard", swap: "se", swapName: "StealthEx", amountOut: 8 },
            { quoteId: "c", type: "private", amountOut: 7 },
            { quoteId: "d", type: "private", amountOut: 6 },
        ],
    };

    it("keeps private routes when a swaps filter is applied", () => {
        const out = compactQuoteResult(mixed, 5, ["cn"]) as any;
        const types = out.quotes.map((q: any) => q.type);
        expect(types.filter((t: string) => t === "private")).toHaveLength(2);
        expect(out.quotes.filter((q: any) => q.type === "standard").every((q: any) => q.swap === "cn")).toBe(true);
    });

    it("does not claim the API ignored the filter when only private routes lack swap", () => {
        const onlyPrivate = { total: 2, quotes: [mixed.quotes[2], mixed.quotes[3]] };
        const out = compactQuoteResult(onlyPrivate, 5, ["cn"]) as any;
        expect(out.quotes).toHaveLength(2);
        expect(out.swapsFilteredClientSide).toBeUndefined();
    });

    it("still filters standard routes that do not match", () => {
        const out = compactQuoteResult(mixed, 5, ["cn"]) as any;
        expect(out.quotes.some((q: any) => q.swap === "se")).toBe(false);
        expect(out.swapsFilteredClientSide).toBe(true);
    });
});

describe("fields the skill depends on", () => {
    it("keeps amountInUsd so price impact does not need a cached price", () => {
        const out = compactQuoteResult(
            { total: 1, quotes: [{ quoteId: "q", type: "dex", amountIn: 5, amountInUsd: 4.99, amountOut: 1, amountOutUsd: 4.98 }] },
            5,
        ) as any;
        expect(out.quotes[0].amountInUsd).toBe(4.99);
    });

    it("keeps the fixed-rate flags that createExchange validates on", () => {
        const out = compactQuoteResult(
            { total: 1, quotes: [{ quoteId: "q", type: "standard", fixed: true, requiresRefundAddress: true, validUntil: "2026-01-01T00:00:00Z" }] },
            5,
        ) as any;
        expect(out.quotes[0].fixed).toBe(true);
        expect(out.quotes[0].requiresRefundAddress).toBe(true);
        expect(out.quotes[0].validUntil).toBe("2026-01-01T00:00:00Z");
    });

    it("lifts the chain display name the token format requires", () => {
        const out = compactToken({
            id: "t", symbol: "ETH", name: "Ethereum", chain: "ethereum",
            chainData: { name: "Ethereum Mainnet", chainId: 1, description: "…" },
        }) as any;
        expect(out.chainName).toBe("Ethereum Mainnet");
        expect(out.chainId).toBe(1);
        expect(out.chainData).toBeUndefined();
    });
});
