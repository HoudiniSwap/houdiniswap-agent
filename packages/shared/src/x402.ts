import { createKeyPairSignerFromBytes, getBase58Encoder } from "@solana/kit";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { BASE_NETWORK, SOLANA_NETWORK, USDC_BASE, USDC_SOLANA } from "./constants.js";
import type { X402Network } from "./types.js";

/** The wallets x402 pays from. At least one is required. */
export interface X402Keys {
    /** EVM private key (0x + 64 hex). Pays with USDC on Base. */
    evm?: `0x${string}`;
    /** Solana secret key in base58, the 64 bytes Phantom or Solflare export. Pays with USDC on Solana. */
    svm?: string;
}

/** Whether `value` is a base58 string that decodes to a 64-byte Solana secret key. */
export const isSvmSecretKey = (value: string): boolean => {
    try {
        return getBase58Encoder().encode(value).length === 64;
    } catch {
        return false;
    }
};

/** A network and token this client agrees to pay with. */
interface PaymentTarget {
    network: string;
    asset: string;
    label: string;
}

const BASE_USDC: PaymentTarget = { network: BASE_NETWORK, asset: USDC_BASE, label: `USDC on Base (${USDC_BASE})` };
const SOLANA_USDC: PaymentTarget = {
    network: SOLANA_NETWORK,
    asset: USDC_SOLANA,
    label: `USDC on Solana (${USDC_SOLANA})`,
};

const NETWORK_TARGETS: Record<X402Network, PaymentTarget> = { base: BASE_USDC, solana: SOLANA_USDC };

/** Whether `value` names a network x402 can pay on (`base` or `solana`). */
export const isX402Network = (value: string): value is X402Network => value === "base" || value === "solana";

// An EVM address is the same in any casing; a Solana mint is base58, where
// casing is part of the address.
const isTarget = (r: PaymentRequirement | undefined, t: PaymentTarget): boolean =>
    r?.network === t.network &&
    typeof r.asset === "string" &&
    (t.network.startsWith("eip155:") ? r.asset.toLowerCase() === t.asset.toLowerCase() : r.asset === t.asset);

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
    /**
     * With both keys, the network tried first. Without it the API's order is
     * used, which puts Base first. Ignored when there is no key for it.
     */
    preferredNetwork?: X402Network;
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
const boundedPaymentPolicy = (targets: readonly PaymentTarget[], maxAmount: bigint) =>
    (_version: number, requirements: readonly PaymentRequirement[]): PaymentRequirement[] =>
        requirements.filter((r) => {
            if (!targets.some((t) => isTarget(r, t))) return false;
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

/**
 * Whether a paid request was refused before the server tried to settle it, so
 * paying again on another network cannot charge twice.
 *
 * In the authorization flow the server settles only after the handler has run.
 * A payment refused before that (verification failed: no funds, a failed
 * simulation) gets a fresh `PAYMENT-REQUIRED` challenge. A failed settlement
 * answers with `PAYMENT-RESPONSE` instead, or with a bare 402 when it threw;
 * either way the transfer may have gone through, so neither counts. Neither
 * does any other flow, since those can settle before the handler.
 */
const refusedBeforeSettlement = (res: Response, accepted?: { extra?: Record<string, unknown> }): boolean => {
    const flow = accepted?.extra?.paymentFlow;
    return (
        res.status === 402 &&
        res.headers.has("payment-required") &&
        !res.headers.has("payment-response") &&
        (flow == null || flow === "authorization")
    );
};

/**
 * A `fetch` that pays for 402 responses. A bare `0x` key pays on Base, as
 * before; `{ evm, svm }` pays with whichever wallets are given. With both,
 * `preferredNetwork` is tried first, or else the first network the server
 * offers (it lists Base first), and a payment refused there before settlement
 * is retried once on the other network.
 */
export const createX402Fetch = (keys: `0x${string}` | X402Keys, options: X402Options = {}): typeof fetch => {
    const { evm, svm } = typeof keys === "string" ? { evm: keys, svm: undefined } : keys;
    if (!evm && !svm) throw new Error("createX402Fetch needs an EVM key, a Solana key, or both");

    const maxPaymentAtomic = options.maxPaymentAtomic ?? DEFAULT_MAX_PAYMENT_ATOMIC;
    const preferred = options.preferredNetwork ? NETWORK_TARGETS[options.preferredNetwork] : undefined;
    // Runs after the policy, so it only chooses among offers this client would
    // pay anyway. The library's default is the first offer.
    const client = new x402Client(
        ((_version: number, requirements: PaymentRequirement[]) =>
            (preferred && requirements.find((r) => isTarget(r, preferred))) ||
            requirements[0]) as unknown as ConstructorParameters<typeof x402Client>[0],
    );
    const targets: PaymentTarget[] = [];

    if (evm) {
        registerExactEvmScheme(client, { signer: privateKeyToAccount(evm) });
        targets.push(BASE_USDC);
    }

    // The Solana signer is built asynchronously, so payments wait for it. A key
    // that fails to load leaves the Solana scheme unregistered: Base keeps
    // paying when there is an EVM key, and with only the Solana key the payment
    // fails with the load error. Catching here also keeps a bad key from
    // crashing the process as an unhandled rejection.
    let svmError: unknown;
    const svmReady = svm
        ? createKeyPairSignerFromBytes(getBase58Encoder().encode(svm)).then(
              (signer) => {
                  registerExactSvmScheme(client, { signer, networks: [SOLANA_NETWORK] });
              },
              (err: unknown) => {
                  svmError = err;
              },
          )
        : Promise.resolve();
    if (svm) targets.push(SOLANA_USDC);

    client.registerPolicy(
        boundedPaymentPolicy(targets, maxPaymentAtomic) as unknown as Parameters<typeof client.registerPolicy>[0],
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
        if (!targets.some((t) => isTarget(r, t)) || amount < 0n || amount > maxPaymentAtomic) {
            return {
                abort: true,
                reason:
                    `refusing to sign a payment of ${describe(r)}. ` +
                    `This client only signs ${targets.map((t) => t.label).join(" or ")} up to ${maxPaymentAtomic} atomic units ` +
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

            await svmReady;
            if (svmError !== undefined && !evm) throw svmError;

            const paymentRequired = httpClient.getPaymentRequiredResponse(
                (name: string) => res.headers.get(name),
                undefined,
            );

            // Signing can stall on the facilitator just as the retry can, so both
            // are bounded.
            const sign = (required: typeof paymentRequired) =>
                withTimeout(client.createPaymentPayload(required), "signing the payment");

            const submit = async (payload: Awaited<ReturnType<typeof sign>>): Promise<Response> => {
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
            };

            let required = paymentRequired;
            let payload = await sign(required);
            let paid = await submit(payload);

            // With keys for two networks, a payment refused before settlement
            // (an empty wallet, most often) gets a turn on the other one. Each
            // network is tried once, and only when nothing can have been taken.
            for (;;) {
                const tried = payload.accepted?.network;
                const others = tried
                    ? required.accepts.filter((r) => r.network !== tried && targets.some((t) => isTarget(r, t)))
                    : [];
                if (others.length === 0 || !refusedBeforeSettlement(paid, payload.accepted)) return paid;

                required = { ...required, accepts: others };
                try {
                    payload = await sign(required);
                } catch {
                    // Why the first network refused says more than why the
                    // other one could not be signed.
                    return paid;
                }
                await paid.body?.cancel().catch(() => {});
                paid = await submit(payload);
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
