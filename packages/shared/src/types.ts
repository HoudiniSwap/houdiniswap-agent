export interface HoudiniConfig {
    baseUrl?: string;
    auth: HoudiniAuth;
}

export type HoudiniAuth =
    | { type: "x402"; privateKey: `0x${string}` }
    | { type: "apiKey"; key: string }
    | { type: "partnerId"; id: string }
    | { type: "none" };

export interface ApiResponse<T = unknown> {
    data: T;
    status: number;
    headers: Headers;
}

export interface ApiError {
    code: string;
    message: string;
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

export interface SwapProvider {
    name: string;
    shortName: string;
    logoUrl?: string;
    type: string;
    enabled: boolean;
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
    rewardsAvailable?: boolean;
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
