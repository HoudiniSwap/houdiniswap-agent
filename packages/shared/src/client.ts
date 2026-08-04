import type { HoudiniConfig, HoudiniAuth, ApiError } from "./types.js";
import { createX402Fetch } from "./x402.js";

const DEFAULT_BASE_URL = "https://api-partner.houdiniswap.com/v2";

export class HoudiniClient {
    private baseUrl: string;
    private auth: HoudiniAuth;
    private fetchFn: typeof fetch;

    constructor(config: HoudiniConfig) {
        this.baseUrl = config.baseUrl?.replace(/\/$/, "") || DEFAULT_BASE_URL;
        this.auth = config.auth;

        if (this.auth.type === "x402") {
            this.fetchFn = createX402Fetch(this.auth.privateKey);
        } else {
            this.fetchFn = fetch;
        }
    }

    private getAuthHeaders(): Record<string, string> {
        switch (this.auth.type) {
            case "apiKey":
                return { Authorization: this.auth.key };
            case "partnerId":
                return { "partner-id": this.auth.id };
            case "x402":
            case "none":
                return {};
        }
    }

    async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
        const url = new URL(`${this.baseUrl}${path}`);
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                if (value === undefined || value === null) continue;
                if (Array.isArray(value)) {
                    for (const item of value) url.searchParams.append(key, String(item));
                } else {
                    url.searchParams.set(key, String(value));
                }
            }
        }

        const res = await this.fetchFn(url.toString(), {
            method: "GET",
            headers: {
                Accept: "application/json",
                ...this.getAuthHeaders(),
            },
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({})) as ApiError;
            throw new HoudiniApiError(res.status, error, this.auth.type);
        }

        return res.json() as Promise<T>;
    }

    async post<T>(path: string, body: unknown): Promise<T> {
        const res = await this.fetchFn(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                ...this.getAuthHeaders(),
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({})) as ApiError;
            throw new HoudiniApiError(res.status, error, this.auth.type);
        }

        return res.json() as Promise<T>;
    }

    getBaseUrl(): string {
        return this.baseUrl;
    }
}

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/**
 * The x402 middleware answers with an empty body, so the generic path would
 * render the single most common failure as "HTTP 402: Unknown error". Say what
 * to actually do about it instead.
 */
const paymentRequiredMessage = (authType?: HoudiniAuth["type"]): string => {
    if (authType === "x402") {
        return `HTTP 402: payment was attempted but not accepted. Check that the x402 wallet holds USDC on Base (${USDC_BASE}) — USDC on any other chain cannot pay for this API.`;
    }
    return "HTTP 402: this endpoint is pay-per-call and no payment method is configured. Set HOUDINI_X402_PRIVATE_KEY to the private key of a wallet holding USDC on Base, or authenticate with HOUDINI_API_KEY.";
};

export class HoudiniApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly error: ApiError,
        authType?: HoudiniAuth["type"],
    ) {
        const details = error.fields
            ? ` — ${Object.entries(error.fields).map(([k, v]) => `${k}: ${v.message}`).join(", ")}`
            : "";
        const message = status === 402 && !error.message
            ? paymentRequiredMessage(authType)
            : `${error.code || "HTTP"} ${status}: ${error.message || "Unknown error"}${details}`;
        super(message);
        this.name = "HoudiniApiError";
    }
}
