import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

export const createX402Fetch = (privateKey: `0x${string}`): typeof fetch => {
    const signer = privateKeyToAccount(privateKey);
    const client = new x402Client();
    registerExactEvmScheme(client, { signer });
    const httpClient = new x402HTTPClient(client);

    // Track last payment time to avoid nonce collisions from rapid sequential requests
    let lastPaymentTime = 0;
    const MIN_PAYMENT_INTERVAL_MS = 5000;

    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const res = await fetch(input, init);

        if (res.status !== 402) return res;

        // Wait if last payment was too recent (EIP-3009 nonce collisions)
        const elapsed = Date.now() - lastPaymentTime;
        if (lastPaymentTime > 0 && elapsed < MIN_PAYMENT_INTERVAL_MS) {
            await new Promise((r) => setTimeout(r, MIN_PAYMENT_INTERVAL_MS - elapsed));
        }

        // Parse payment requirements from 402 response
        const paymentRequired = httpClient.getPaymentRequiredResponse(
            (name: string) => res.headers.get(name),
            undefined,
        );

        // Create signed payment payload
        const payload = await client.createPaymentPayload(paymentRequired);
        const paymentHeaders = httpClient.encodePaymentSignatureHeader(payload);

        lastPaymentTime = Date.now();

        // Retry with payment headers
        return fetch(url, {
            ...init,
            headers: { ...init?.headers, ...paymentHeaders },
        });
    };
};
