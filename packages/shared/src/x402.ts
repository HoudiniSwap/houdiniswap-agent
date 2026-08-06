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

            const payload = await client.createPaymentPayload(paymentRequired);
            const paymentHeaders = httpClient.encodePaymentSignatureHeader(payload);

            try {
                return await fetch(url, {
                    ...init,
                    headers: { ...init?.headers, ...paymentHeaders },
                });
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
