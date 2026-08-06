import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

export const createX402Fetch = (privateKey: `0x${string}`): typeof fetch => {
    const signer = privateKeyToAccount(privateKey);
    const client = new x402Client();
    registerExactEvmScheme(client, { signer });
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
