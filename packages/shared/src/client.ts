import { USDC_BASE } from "./constants.js";
import type { HoudiniConfig, HoudiniAuth, ApiError } from "./types.js";
import { createX402Fetch } from "./x402.js";

const DEFAULT_BASE_URL = "https://api-partner.houdiniswap.com/v2";

/** Ceiling on any single request. The paid retry has its own 60s bound. */
const DEFAULT_TIMEOUT_MS = 30_000;

export class HoudiniClient {
    private baseUrl: string;
    private auth: HoudiniAuth;
    private fetchFn: typeof fetch;
    private timeoutMs: number;

    constructor(config: HoudiniConfig) {
        this.baseUrl = config.baseUrl?.replace(/\/$/, "") || DEFAULT_BASE_URL;
        this.auth = config.auth;
        this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

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

    /**
     * A 2xx whose body is not JSON used to surface as a bare `SyntaxError:
     * Unexpected token '<'`, which says nothing about what happened. A proxy,
     * gateway or captive portal answering with HTML is the usual cause, and the
     * agent needs to be told that rather than shown a parser message.
     */
    private static async parseJson<T>(res: Response, path: string): Promise<T> {
        const text = await res.text();
        if (text.trim() === "") {
            throw new HoudiniApiError(res.status, {
                code: "EMPTY_RESPONSE",
                message: `GET/POST ${path} returned HTTP ${res.status} with an empty body where JSON was expected.`,
            });
        }
        try {
            return JSON.parse(text) as T;
        } catch {
            const contentType = res.headers.get("content-type") ?? "unknown";
            throw new HoudiniApiError(res.status, {
                code: "INVALID_JSON",
                message:
                    `${path} returned HTTP ${res.status} with a non-JSON body (content-type: ${contentType}). ` +
                    `This usually means a proxy or gateway answered instead of the API. First bytes: ${JSON.stringify(text.slice(0, 80))}`,
            });
        }
    }

    /**
     * An upstream that accepts the connection and then goes silent left calls
     * pending indefinitely — the x402 layer reasoned carefully about stalls
     * wedging the payment queue, while the far more common stall, an ordinary
     * request, was unbounded. The paid retry has its own 60s bound; this covers
     * everything else.
     */
    private async withTimeout(run: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            return await run(controller.signal);
        } catch (err) {
            if (controller.signal.aborted) {
                throw new Error(`Request timed out after ${this.timeoutMs}ms`);
            }
            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Error bodies get the same treatment as success bodies. Routing only the
     * success path through the JSON guard fixed the rarer case and missed the
     * likelier one: a proxy answering a 502 with HTML collapsed to
     * "HTTP 502: Unknown error" with an empty error object.
     */
    private static async errorBody(res: Response, path: string): Promise<ApiError> {
        try {
            return await HoudiniClient.parseJson<ApiError>(res, path);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { code: "NON_JSON_ERROR", message };
        }
    }

    /**
     * `new URL()` resolves `..` segments, so an unescaped path parameter walks
     * out of its endpoint: `/orders/../chains` became a call to `/chains`,
     * returning that endpoint's payload to a caller expecting an order.
     *
     * The check compares the *normalised* result against the endpoint the caller
     * asked for. An earlier version inspected the raw string for a literal ".."
     * instead, which meant enumerating encodings — and it missed `%2e%2e` and
     * `..\` (WHATWG treats a backslash as a separator for http/https, so
     * splitting on "/" sees one atom). Testing the outcome catches every
     * spelling at once.
     *
     * Callers still encode their path parameters; this catches the ones that
     * forget rather than silently calling somewhere else.
     */
    private assertPathStaysWithinBase(path: string): void {
        const base = new URL(this.baseUrl);
        const basePath = base.pathname.replace(/\/$/, "");

        // The endpoint the caller intended: the first path segment, with any
        // query string or fragment removed first — callers pass paths like
        // "/quotes?amount=-1" and those must not be treated as a segment.
        const pathOnly = path.split(/[?#]/)[0];
        const intended = `${basePath}/${pathOnly.replace(/^\//, "").split("/")[0]}`;

        let resolved: URL;
        try {
            resolved = new URL(`${this.baseUrl}${path}`);
        } catch {
            throw new Error(`Refusing to request "${path}": it is not a valid URL path.`);
        }

        if (resolved.origin !== base.origin) {
            throw new Error(
                `Refusing to request "${path}": it resolves to ${resolved.origin}, not ${base.origin}.`,
            );
        }
        if (resolved.pathname !== intended && !resolved.pathname.startsWith(`${intended}/`)) {
            throw new Error(
                `Refusing to request "${path}": it resolves to ${resolved.pathname}, outside the intended ` +
                    `endpoint ${intended}. Encode path parameters with encodeURIComponent — an unescaped ` +
                    "'..', '%2e%2e' or backslash lets a parameter reach a different endpoint.",
            );
        }
    }

    async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
        const url = new URL(`${this.baseUrl}${path}`);
        this.assertPathStaysWithinBase(path);
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

        const res = await this.withTimeout((signal) =>
            this.fetchFn(url.toString(), {
                method: "GET",
                headers: {
                    Accept: "application/json",
                    ...this.getAuthHeaders(),
                },
                signal,
            }),
        );

        if (!res.ok) {
            throw new HoudiniApiError(res.status, await HoudiniClient.errorBody(res, path), this.auth.type);
        }

        return HoudiniClient.parseJson<T>(res, path);
    }

    async post<T>(path: string, body: unknown): Promise<T> {
        this.assertPathStaysWithinBase(path);
        const res = await this.withTimeout((signal) =>
            this.fetchFn(`${this.baseUrl}${path}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    ...this.getAuthHeaders(),
                },
                body: JSON.stringify(body),
                signal,
            }),
        );

        if (!res.ok) {
            throw new HoudiniApiError(res.status, await HoudiniClient.errorBody(res, path), this.auth.type);
        }

        return HoudiniClient.parseJson<T>(res, path);
    }

    getBaseUrl(): string {
        return this.baseUrl;
    }
}

/**
 * The x402 middleware answers with an empty body, so the generic path would
 * render the single most common failure as "HTTP 402: Unknown error". Say what
 * to actually do about it instead.
 */
const paymentRequiredMessage = (authType?: HoudiniAuth["type"], reason?: string): string => {
    if (authType === "x402") {
        // The facilitator reports why it refused in `error` (x402 carries it
        // there, never in `message`). Discarding it meant a settlement collision
        // and an empty wallet produced the same "go fund your wallet" advice —
        // which sent me to check a wallet that was already funded.
        const why = reason ? ` Facilitator reason: ${reason}.` : "";
        return `HTTP 402: payment was attempted but not accepted.${why} Check that the x402 wallet holds USDC on Base (${USDC_BASE}) — USDC on any other chain cannot pay for this API.`;
    }
    return "HTTP 402: this endpoint is pay-per-call and no payment method is configured. Set HOUDINI_X402_PRIVATE_KEY to the private key of a wallet holding USDC on Base, or authenticate with HOUDINI_API_KEY.";
};

export class HoudiniApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly error: ApiError,
        authType?: HoudiniAuth["type"],
    ) {
        const details = error?.fields
            ? ` — ${Object.entries(error.fields).map(([k, v]) => `${k}: ${v.message}`).join(", ")}`
            : "";
        const message = status === 402 && !error?.message
            ? paymentRequiredMessage(authType, error?.error)
            : `${error?.code || "HTTP"} ${status}: ${error?.message || "Unknown error"}${details}`;
        super(message);
        this.name = "HoudiniApiError";
    }
}
