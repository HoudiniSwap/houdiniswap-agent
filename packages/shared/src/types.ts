export interface HoudiniConfig {
    baseUrl?: string;
    auth: HoudiniAuth;
    /** Ceiling on any single request, in ms. Defaults to 30000. */
    timeoutMs?: number;
    /** x402 only: called after each paid request that succeeded, with what was paid and from where. */
    onPayment?: (payment: X402Payment) => void;
}

/** One x402 payment, as the API's receipt reports it. */
export interface X402Payment {
    /** The network that paid, in CAIP-2 (`eip155:8453`, `solana:5eykt…`). */
    network: string;
    /** In USDC atomic units (6 decimals). */
    amount: string;
    /** The wallet that paid, as the facilitator reports it. */
    payer?: string;
    /** The settlement transaction: a hash on Base, a signature on Solana. */
    transaction?: string;
    /** Networks tried first that refused before settling, so nothing was charged on them. */
    refused: Array<{ network: string; reason?: string }>;
}

/** A network x402 can pay on: USDC on Base or USDC on Solana. */
export type X402Network = "base" | "solana";

/**
 * x402 pays per call from `privateKey` (EVM, USDC on Base), `svmPrivateKey`
 * (Solana secret key in base58, USDC on Solana), or both. With both, `network`
 * picks the one tried first; without it, the API's order is used (Base first).
 */
export type HoudiniAuth =
    | { type: "x402"; privateKey: `0x${string}`; svmPrivateKey?: string; network?: X402Network }
    | { type: "x402"; privateKey?: `0x${string}`; svmPrivateKey: string; network?: X402Network }
    | { type: "apiKey"; key: string }
    | { type: "partnerId"; id: string }
    | { type: "none" };

export interface ApiResponse<T = unknown> {
    data: T;
    status: number;
    headers: Headers;
}

export interface ApiError {
    /** Absent on some responses — the x402 middleware returns an empty body. */
    code?: string;
    /** Absent on some responses — see `code`. */
    message?: string;
    /**
     * x402 reports why a payment was refused here rather than in `message`
     * (e.g. "invalid_exact_evm_transaction_failed"). Without it, a settlement
     * collision and an unfunded wallet are indistinguishable.
     */
    error?: string;
    requestId?: string;
    fields?: Record<string, { message: string; value?: unknown }>;
}

export interface TokenResult {
    total: number;
    tokens: Token[];
}

export interface Token {
    id: string;
    symbol: string;
    name: string;
    chain: string;
    address: string | null;
    decimals: number;
    mainnet?: boolean;
    unverified?: boolean;
    hasCex: boolean;
    hasDex: boolean;
    cexTokenId?: string;
    price?: number;
    icon?: string;
    chainData?: ChainData;
}

export interface ChainResult {
    total: number;
    chains: Chain[];
}

export interface Chain {
    id: string;
    name: string;
    shortName: string;
    explorerUrl?: string;
    addressUrl?: string;
    memoNeeded?: boolean;
    hasCex?: boolean;
    hasDex?: boolean;
}

/** Shape of a row from `GET /swaps`, which returns a bare array. */
export interface SwapProvider {
    id: string;
    name: string;
    /** What the `swaps` quote filter takes, e.g. "cn", "el", "nx". */
    shortName: string;
    enabled: boolean;
    isDex: boolean;
    deprecated?: boolean;
    txUrl?: string;
    logoUrl?: string;
    markupSupported?: boolean;
    slippageSupported?: boolean;
    autoSlippageSupported?: boolean;
}

export interface QuoteResult {
    quotes: Quote[];
}

export interface Quote {
    quoteId: string;
    swap: string;
    swapName: string;
    type: string;
    amountIn?: number;
    amountOut?: number;
    amountOutUsd?: number;
    netAmountOut?: number;
    duration?: number;
    gas?: number;
    logoUrl?: string;
    min?: number;
    max?: number;
    markupSupported?: boolean;
    requiresApproval?: boolean;
    error?: string;
}

export interface ExchangeRequest {
    quoteId: string;
    addressTo: string;
    addressFrom?: string;
    destinationTag?: string;
}

export interface Order {
    houdiniId: string;
    id?: string;
    status: number;
    statusLabel?: string;
    displayStatus?: string;
    depositAddress?: string;
    receiverAddress?: string;
    inAmount?: number;
    inSymbol?: string;
    outAmount?: number;
    outSymbol?: string;
    inAmountUsd?: number;
    swapName?: string;
    eta?: number;
    created?: string;
    expires?: string;
    isX402?: boolean;
    anonymous?: boolean;
}

export interface MinMaxResult {
    cex?: { min: number; max: number };
    dex?: { min: number; max: number };
    private?: { min: number; max: number };
}

export interface ChainData {
    name: string;
    shortName: string;
}
