import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { USDC_BASE } from "./constants.js";

/** Base mainnet, the only network this API settles on. */
const BASE_NETWORK = "eip155:8453";

/**
 * Ceiling on a single payment, in USDC atomic units (6 decimals).
 * 100_000 = $0.10, which is 10x the most expensive documented call ($0.01) and
 * far below anything that would matter if a wallet were drained one call at a
 * time.
 */
const DEFAULT_MAX_PAYMENT_ATOMIC = 100_000n;

export interface X402Options {
    /** Ceiling per payment in USDC atomic units. Defaults to 100_000 ($0.10). */
    maxPaymentAtomic?: bigint;
}

/**
 * Everything about a payment — amount, recipient, asset, chain — arrives in the
 * server's 402 challenge. Without a policy the signer accepts all of it: pointed
 * at a hostile server, a $0.0001 tool call signs whatever authorisation it is
 * handed. That was demonstrated against a mock returning a 402 demanding
 * 1,000,000 USDC to an arbitrary address, valid for a year — the wallet signed it.
 *
 * `HOUDINI_API_URL` is an environment variable with no allowlist, so "hostile
 * server" needs only a redirected base URL or a compromised host, not a broken
 * library.
 *
 * This filters the offers before one is chosen, and the hook below refuses
 * outright if nothing survives — so the failure is a clear error rather than a
 * signature.
 */
const boundedPaymentPolicy = (maxAmount: bigint) =>
    (_version: number, requirements: readonly PaymentRequirement[]): PaymentRequirement[] =>
        requirements.filter((r) => {
            if (r.network !== BASE_NETWORK) return false;
            if (typeof r.asset !== "string" || r.asset.toLowerCase() !== USDC_BASE.toLowerCase()) return false;
            if (typeof r.amount !== "string") return false;
            let amount: bigint;
            try {
                amount = BigInt(r.amount);
            } catch {
                return false;
            }
            return amount >= 0n && amount <= maxAmount;
        });

interface PaymentRequirement {
    scheme?: string;
    network?: string;
    amount?: string;
    asset?: string;
    payTo?: string;
}

const describe = (r?: PaymentRequirement): string =>
    r ? `${r.amount ?? "?"} of ${r.asset ?? "?"} on ${r.network ?? "?"} to ${r.payTo ?? "?"}` : "nothing";

export const createX402Fetch = (privateKey: `0x${string}`, options: X402Options = {}): typeof fetch => {
    const maxPaymentAtomic = options.maxPaymentAtomic ?? DEFAULT_MAX_PAYMENT_ATOMIC;
    const signer = privateKeyToAccount(privateKey);
    const client = new x402Client();
    registerExactEvmScheme(client, { signer });

    client.registerPolicy(
        boundedPaymentPolicy(maxPaymentAtomic) as unknown as Parameters<typeof client.registerPolicy>[0],
    );

    // The policy filters; this makes the refusal legible instead of surfacing as
    // the library's generic "all requirements were filtered out".
    client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
        const r = selectedRequirements as PaymentRequirement;
        const amount = (() => {
            try {
                return BigInt(r?.amount ?? "0");
            } catch {
                return -1n;
            }
        })();
        if (
            r?.network !== BASE_NETWORK ||
            r?.asset?.toLowerCase() !== USDC_BASE.toLowerCase() ||
            amount < 0n ||
            amount > maxPaymentAtomic
        ) {
            return {
                abort: true,
                reason:
                    `refusing to sign a payment of ${describe(r)}. ` +
                    `This client only signs USDC on Base (${USDC_BASE}) up to ${maxPaymentAtomic} atomic units ` +
                    `(${Number(maxPaymentAtomic) / 1e6} USDC). A server asking for more than the endpoint's price ` +
                    "should be treated as hostile.",
            };
        }
    });

    const httpClient = new x402HTTPClient(client);

    let lastPaymentTime = 0;
    const MIN_PAYMENT_INTERVAL_MS = 5000;
    const PAYMENT_TIMEOUT_MS = 60_000;

    /**
     * Because payments are serialised, a request that never settles blocks every
     * payment behind it — permanently, and with nothing logged. A bound turns
     * that into one failed call instead of a server that silently stops paying
     * for anything.
     */
    const withTimeout = async <T>(work: Promise<T>, stage: string): Promise<T> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                work,
                new Promise<never>((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error(`x402 payment timed out after ${PAYMENT_TIMEOUT_MS}ms while ${stage}`)),
                        PAYMENT_TIMEOUT_MS,
                    );
                }),
            ]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    };

    /**
     * Payments are settled on-chain by the facilitator, and two settlements from
     * the same payer in flight at once collide: the facilitator answers 402 with
     * `errorReason: "invalid_exact_evm_transaction_failed"`. Firing three paid
     * requests concurrently reproducibly leaves exactly one succeeding.
     *
     * So the whole 402 -> sign -> retry sequence runs one at a time, and the
     * interval is measured from the end of the previous settlement rather than
     * from when it was signed. Unpaid requests never touch this queue.
     */
    let paymentQueue: Promise<unknown> = Promise.resolve();

    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const res = await fetch(input, init);

        if (res.status !== 402) return res;

        const settle = paymentQueue.then(async () => {
            const elapsed = Date.now() - lastPaymentTime;
            if (lastPaymentTime > 0 && elapsed < MIN_PAYMENT_INTERVAL_MS) {
                await new Promise((r) => setTimeout(r, MIN_PAYMENT_INTERVAL_MS - elapsed));
            }

            const paymentRequired = httpClient.getPaymentRequiredResponse(
                (name: string) => res.headers.get(name),
                undefined,
            );

            // Signing can stall on the facilitator just as the retry can, so both
            // are bounded.
            const payload = await withTimeout(
                client.createPaymentPayload(paymentRequired),
                "signing the payment",
            );
            const paymentHeaders = httpClient.encodePaymentSignatureHeader(payload);

            // Aborting actually closes the socket; the race alone would leave it
            // open and still consuming a connection.
            const controller = new AbortController();
            try {
                return await withTimeout(
                    fetch(url, {
                        ...init,
                        headers: { ...init?.headers, ...paymentHeaders },
                        signal: controller.signal,
                    }),
                    "submitting the paid request",
                );
            } catch (err) {
                controller.abort();
                throw err;
            } finally {
                // After the retry resolves, so the next payment waits out this
                // settlement rather than starting the clock at signing time.
                lastPaymentTime = Date.now();
            }
        });

        // Keep the chain alive even if this payment throws, or one failure would
        // wedge every request queued behind it.
        paymentQueue = settle.then(
            () => undefined,
            () => undefined,
        );

        return settle;
    };
};
