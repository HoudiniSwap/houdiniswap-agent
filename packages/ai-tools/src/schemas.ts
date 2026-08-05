import { z } from "zod";

export const tokensSchema = z.object({
    symbol: z.string().optional().describe("Exact symbol match (e.g. 'BTC', 'ETH', 'USDC')"),
    chain: z.string().optional().describe("Filter by chain shortName (e.g. 'ethereum', 'bitcoin', 'solana')"),
    term: z.string().optional().describe("Search term (name, symbol, or address)"),
    address: z.string().optional().describe("Filter by contract address"),
    hasCex: z.boolean().optional().describe("Only tokens available on CEX providers"),
    hasDex: z.boolean().optional().describe("Only tokens available on DEX providers"),
    mainnet: z.boolean().optional().describe("Only native/mainnet tokens"),
    page: z.number().int().min(1).default(1).optional().describe("Page number"),
    pageSize: z.number().int().min(1).max(100).default(20).optional().describe("Results per page"),
});

export const chainsSchema = z.object({
    hasCex: z.boolean().optional().describe("Only chains with CEX support"),
    hasDex: z.boolean().optional().describe("Only chains with DEX support"),
    kind: z.string().optional().describe("Chain kind filter"),
    name: z.string().optional().describe("Search by chain name"),
    page: z.number().int().min(1).default(1).optional(),
    pageSize: z.number().int().min(1).max(100).default(100).optional(),
});

export const quoteSchema = z.object({
    from: z.string().describe("Source token ID (from getTokens)"),
    to: z.string().describe("Destination token ID (from getTokens)"),
    amount: z.number().positive().describe("Amount to swap in source token units"),
    types: z.array(z.enum(["standard", "private", "dex"])).optional().describe("Quote types to include (default: all)"),
    slippage: z.number().min(0).max(50).optional().describe("Max slippage % for DEX quotes"),
    senderAddress: z.string().optional().describe("Sender wallet address (required for DEX)"),
    receiverAddress: z.string().optional().describe("Receiver wallet address"),
    sort: z.enum(["amountOut", "amountOutUsd", "duration"]).optional().describe("Sort quotes by"),
    sortOrder: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
});

export const exchangeSchema = z.object({
    quoteId: z.string().describe("Quote ID from getQuote response"),
    addressTo: z.string().describe("Destination wallet address for receiving funds"),
    addressFrom: z.string().optional().describe("Source wallet address (required for DEX swaps)"),
    destinationTag: z.string().optional().describe("Destination tag/memo (for XRP, XLM, etc.)"),
});

export const orderSchema = z.object({
    houdiniId: z.string().describe("The Houdini order ID (e.g. 'HOUDINI...')"),
});

export const ordersSchema = z.object({
    page: z.number().int().min(1).default(1).optional(),
    pageSize: z.number().int().min(1).max(100).default(20).optional(),
    status: z.number().optional().describe("Filter by order status code"),
    dateFrom: z.string().optional().describe("Start date (ISO 8601)"),
    dateTo: z.string().optional().describe("End date (ISO 8601)"),
    multiId: z.string().optional().describe("Filter by multi-order ID"),
});

export const minMaxSchema = z.object({
    tokenIdFrom: z.string().describe("Source token ID (from getTokens)"),
    tokenIdTo: z.string().describe("Destination token ID (from getTokens)"),
});

// These mirror the API request bodies exactly. They previously used `address`
// and `quoteId` where the API expects `addressFrom` and `id`; since the API
// rejects unknown properties, every DEX call returned 422.
export const dexApproveSchema = z.object({
    quoteId: z.string().describe("Quote ID from getQuote (DEX quote)"),
    addressFrom: z.string().describe("Address the amount will be deducted from (EVM 0x… or Tron T…)"),
    usePermit: z.boolean().optional().describe("Use permit instead of approve; defaults to true where supported"),
});

export const dexAllowanceSchema = z.object({
    quoteId: z.string().describe("Quote ID from getQuote (DEX quote)"),
    addressFrom: z.string().describe("Address the amount will be deducted from (EVM 0x… or Tron T…)"),
    usePermit: z.boolean().optional().describe("Use permit instead of approve; defaults to true where supported"),
});

export const dexConfirmTxSchema = z.object({
    id: z.string().min(3).describe("The Houdini order ID (houdiniId from createExchange) — not the quote ID"),
    txHash: z.string().optional().describe("Transaction hash. Required for on-chain orders, optional for off-chain."),
});

export const dexChainSignaturesSchema = z.object({
    quoteId: z.string().describe("Quote ID from getQuote"),
    addressFrom: z.string().describe("EVM address the amount will be deducted from"),
    previousSignature: z
        .object({
            signature: z.string(),
            key: z.string(),
            swapRequiredMetadata: z.record(z.unknown()).optional(),
        })
        .describe("The signature object produced by the wallet in the previous step"),
    signatureKey: z.string().describe("Signature key returned by the previous approve or chainSignatures call"),
    signatureStep: z.number().int().min(0).describe("Step number in the signature chain sequence"),
});

export const swapSchema = z.object({
    fromSymbol: z.string().describe("Source token symbol (e.g. 'BTC', 'ETH')"),
    fromChain: z.string().describe("Source chain (e.g. 'bitcoin', 'ethereum')"),
    toSymbol: z.string().describe("Destination token symbol (e.g. 'ETH', 'USDT')"),
    toChain: z.string().describe("Destination chain (e.g. 'ethereum', 'tron')"),
    amount: z.number().positive().describe("Amount to swap in source token units"),
    addressTo: z.string().describe("Destination wallet address"),
});
