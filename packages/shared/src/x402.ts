import { createKeyPairSignerFromBytes, getBase58Encoder } from "@solana/kit";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { BASE_NETWORK, SOLANA_NETWORK, USDC_BASE, USDC_SOLANA } from "./constants.js";
import type { X402Network, X402Payment } from "./types.js";

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

/**
 * The addresses HoudiniSwap's production API takes x402 payments at. A 402
 * naming any other recipient is refused. Other environments use other wallets:
 * pass `payTo` for them.
 *
 * These mirror the backend's X402_RECEIVING_ADDRESS and
 * X402_SOLANA_RECEIVING_ADDRESS. Changing either in production before installed
 * clients know the new address makes every one of them refuse to pay on that
 * network, and a client with only a Solana key loses every paid call. To rotate:
 * add the new address here next to the old one (several per network are
 * accepted), release, let clients update, then switch the backend, and only
 * drop the old address in a later release.
 */
export const DEFAULT_X402_PAY_TO: Readonly<Record<X402Network, readonly string[]>> = {
    base: ["0xe2FBF4e7F29Ad53F0D28BCbCF4088277C9916eAC"],
    solana: ["Bdg25JW8RBHKeq5YDWDrbH5Q2H8GaZFwqD6G4zPn2P2x"],
};

/** A network, token and recipients this client agrees to pay with. */
interface PaymentTarget {
    network: string;
    asset: string;
    payTo: readonly string[];
    label: string;
}

const NETWORK_ASSETS: Record<X402Network, { network: string; asset: string; name: string }> = {
    base: { network: BASE_NETWORK, asset: USDC_BASE, name: "Base" },
    solana: { network: SOLANA_NETWORK, asset: USDC_SOLANA, name: "Solana" },
};

const paymentTarget = (network: X402Network, payTo: readonly string[]): PaymentTarget => {
    const { network: caip, asset, name } = NETWORK_ASSETS[network];
    return { network: caip, asset, payTo, label: `USDC on ${name} (${asset}) to ${payTo.join(" or ")}` };
};

/** Whether `value` names a network x402 can pay on (`base` or `solana`). */
export const isX402Network = (value: string): value is X402Network => value === "base" || value === "solana";

// An EVM address is the same in any casing; a Solana address is base58, where
// casing is part of the address.
const sameAddress = (network: string, a: string, b: string): boolean =>
    network.startsWith("eip155:") ? a.toLowerCase() === b.toLowerCase() : a === b;

const isTarget = (r: PaymentRequirement | undefined, t: PaymentTarget): boolean =>
    r?.network === t.network &&
    typeof r.asset === "string" &&
    sameAddress(t.network, r.asset, t.asset) &&
    typeof r.payTo === "string" &&
    t.payTo.some((p) => sameAddress(t.network, r.payTo as string, p));

/**
 * Ceiling on a single payment, in USDC atomic units (6 decimals).
 * 100_000 = $0.10, which is 10x the most expensive documented call ($0.01) and
 * far below anything that would matter if a wallet were drained one call at a
 * time.
 */
const DEFAULT_MAX_PAYMENT_ATOMIC = 100_000n;

/**
 * Ceiling on everything one client signs, in USDC atomic units: $10, which is
 * 1,000 exchanges or 10,000 quotes at the documented prices.
 */
const DEFAULT_BUDGET_ATOMIC = 10_000_000n;

const SPENDING_LIMIT = "spending limit reached";

const usdc = (atomic: bigint): string => `${Number(atomic) / 1e6} USDC`;

export interface X402Options {
    /** Ceiling per payment in USDC atomic units. Defaults to 100_000 ($0.10). */
    maxPaymentAtomic?: bigint;
    /**
     * Ceiling on the total this client signs over its lifetime, in USDC atomic
     * units. Every signed payment counts, including one refused on the first
     * network before the other is tried. Defaults to 10_000_000 ($10).
     */
    budgetAtomic?: bigint;
    /**
     * Recipients this client pays, per network. A network given here replaces
     * its entry in `DEFAULT_X402_PAY_TO`, so pointing at another HoudiniSwap
     * environment means listing that environment's addresses. Several addresses
     * per network are allowed, for a wallet change.
     */
    payTo?: Partial<Record<X402Network, readonly string[]>>;
    /**
     * With both keys, the network tried first. Without it the API's order is
     * used, which puts Base first. Ignored when there is no key for it.
     */
    preferredNetwork?: X402Network;
    /** Called after each paid request that succeeded. An error it throws is ignored. */
    onPayment?: (payment: X402Payment) => void;
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
 * The recipient is pinned as well: with only the amount bounded, a hostile
 * server still collects the price of every call it is sent.
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
 * Thrown when a request carrying a signed payment fails without an answer:
 * the payment may already be settled and the request carried out (an order
 * created, say), so the caller must not treat it as a plain failure and retry.
 */
export class X402PaymentUnconfirmedError extends Error {
    constructor(cause: unknown) {
        const why = cause instanceof Error ? cause.message : String(cause);
        super(
            `x402: a signed payment was sent with this request, but no answer came back (${why}). ` +
                "The payment may have been taken and the request carried out — an order may already exist. " +
                "Do not retry blindly: check the order list or the order first.",
            { cause },
        );
        this.name = "X402PaymentUnconfirmedError";
    }
}

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
    const budgetAtomic = options.budgetAtomic ?? DEFAULT_BUDGET_ATOMIC;
    const targetFor = (network: X402Network): PaymentTarget =>
        paymentTarget(network, options.payTo?.[network] ?? DEFAULT_X402_PAY_TO[network]);
    const preferred = options.preferredNetwork ? targetFor(options.preferredNetwork) : undefined;
    // What this client has signed so far. Payments run one at a time (see the
    // queue below), so the check in the hook and the update after signing
    // cannot interleave.
    let spentAtomic = 0n;
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
        targets.push(targetFor("base"));
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
    if (svm) targets.push(targetFor("solana"));

    client.registerPolicy(
        boundedPaymentPolicy(targets, maxPaymentAtomic) as unknown as Parameters<typeof client.registerPolicy>[0],
    );

    const refusal = (offered: string): string =>
        `refusing to sign a payment of ${offered}. ` +
        `This client only signs ${targets.map((t) => t.label).join(" or ")} up to ${maxPaymentAtomic} atomic units ` +
        `(${usdc(maxPaymentAtomic)}). A server asking for more than the endpoint's price, or naming ` +
        "another recipient, should be treated as hostile. For another HoudiniSwap environment, set its " +
        "recipients with the payTo option (HOUDINI_X402_PAY_TO_BASE / HOUDINI_X402_PAY_TO_SOLANA for the MCP server).";

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
            return { abort: true, reason: refusal(describe(r)) };
        }
        if (spentAtomic + amount > budgetAtomic) {
            return {
                abort: true,
                reason:
                    `${SPENDING_LIMIT}: this client has signed ${usdc(spentAtomic)} of payments and the next one ` +
                    `(${usdc(amount)}) would pass the ${usdc(budgetAtomic)} limit. The limit lasts as long as the client: ` +
                    "restart the MCP server (in HTTP mode it is shared by every caller), or create a new client. " +
                    "To allow more, raise it with HOUDINI_X402_BUDGET_USDC for the MCP server, or the budgetAtomic option.",
            };
        }
    });

    const httpClient = new x402HTTPClient(client);

    // The facilitator's reason travels in the fresh challenge's `error`.
    const refusalReason = (res: Response): string | undefined => {
        try {
            return httpClient.getPaymentRequiredResponse((name: string) => res.headers.get(name), undefined).error;
        } catch {
            return undefined;
        }
    };

    // The receipt names the payer and the transaction but not the amount
    // (it does only for schemes that settle less than authorised), so that
    // comes from the offer that was signed. Reporting is best-effort: the call
    // has already been paid for and must not fail over it.
    const reportPayment = (
        accepted: PaymentRequirement | undefined,
        res: Response,
        refused: X402Payment["refused"],
    ): void => {
        if (!options.onPayment || !accepted?.network) return;
        let receipt: { payer?: string; transaction?: string; amount?: string } = {};
        try {
            receipt = httpClient.getPaymentSettleResponse((name: string) => res.headers.get(name));
        } catch {
            // No readable receipt: report what was signed.
        }
        try {
            options.onPayment({
                network: accepted.network,
                amount: receipt.amount ?? accepted.amount ?? "0",
                ...(receipt.payer && { payer: receipt.payer }),
                ...(receipt.transaction && { transaction: receipt.transaction }),
                refused,
            });
        } catch {
            // Ignored, as documented.
        }
    };

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
            // Counted once signed, whether or not it settles: a signed
            // authorisation is out of this client's hands.
            const sign = async (required: typeof paymentRequired) => {
                const payload = await withTimeout(client.createPaymentPayload(required), "signing the payment").catch(
                    (err: unknown) => {
                        // When the policy leaves nothing, the library says only
                        // that; name what was offered and what would be signed.
                        if (err instanceof Error && /filtered out by polic/i.test(err.message)) {
                            throw new Error(refusal(required.accepts.map((r) => describe(r as PaymentRequirement)).join(" or ")), {
                                cause: err,
                            });
                        }
                        throw err;
                    },
                );
                spentAtomic += BigInt((payload.accepted as PaymentRequirement | undefined)?.amount ?? "0");
                return payload;
            };

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
                    throw new X402PaymentUnconfirmedError(err);
                } finally {
                    // After the retry resolves, so the next payment waits out this
                    // settlement rather than starting the clock at signing time.
                    lastPaymentTime = Date.now();
                }
            };

            let required = paymentRequired;
            let payload = await sign(required);
            let paid = await submit(payload);
            const refused: X402Payment["refused"] = [];

            // With keys for two networks, a payment refused before settlement
            // (an empty wallet, most often) gets a turn on the other one. Each
            // network is tried once, and only when nothing can have been taken.
            for (;;) {
                const tried = payload.accepted?.network;
                const others = tried
                    ? required.accepts.filter((r) => r.network !== tried && targets.some((t) => isTarget(r, t)))
                    : [];
                if (others.length === 0 || !refusedBeforeSettlement(paid, payload.accepted)) {
                    if (paid.ok) reportPayment(payload.accepted, paid, refused);
                    return paid;
                }

                required = { ...required, accepts: others };
                try {
                    payload = await sign(required);
                } catch (err) {
                    // The spending limit is the one reason that says more: the
                    // first network's refusal would send the user looking for
                    // missing funds instead.
                    if (err instanceof Error && err.message.includes(SPENDING_LIMIT)) {
                        await paid.body?.cancel().catch(() => {});
                        throw err;
                    }
                    // Otherwise why the first network refused says more than
                    // why the other one could not be signed.
                    return paid;
                }
                refused.push({ network: tried as string, reason: refusalReason(paid) });
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
