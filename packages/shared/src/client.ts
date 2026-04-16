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
            throw new HoudiniApiError(res.status, error);
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
            throw new HoudiniApiError(res.status, error);
        }

        return res.json() as Promise<T>;
    }

    getBaseUrl(): string {
        return this.baseUrl;
    }
}

export class HoudiniApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly error: ApiError,
    ) {
        const details = error.fields
            ? ` — ${Object.entries(error.fields).map(([k, v]) => `${k}: ${v.message}`).join(", ")}`
            : "";
        super(`${error.code || "HTTP"} ${status}: ${error.message || "Unknown error"}${details}`);
        this.name = "HoudiniApiError";
    }
}
