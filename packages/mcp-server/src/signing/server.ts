import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { renderSignPage, type OrderFacts, type SignableTransaction } from "./page.js";

/**
 * A loopback signer for DEX transactions, so a user never has to paste a private
 * key into anything. The page hands the transaction to `window.ethereum` and the
 * wallet shows its own confirmation; the key never leaves the wallet.
 *
 * See docs/local-signing.md for the design and threat model.
 */

export type SignStatus = "pending" | "signed" | "rejected" | "expired";

export interface PendingSignature {
    token: string;
    houdiniId: string;
    tx: SignableTransaction;
    chainId: number;
    order: OrderFacts;
    expiresAt: number;
    status: SignStatus;
    txHash?: string;
    error?: string;
}

const HOST = "127.0.0.1";
/** Swept on every request; also bounds how long a stale entry can linger. */
const SWEEP_INTERVAL_MS = 30_000;

export class SigningServer {
    private server?: Server;
    private port?: number;
    private readonly pending = new Map<string, PendingSignature>();
    private sweepTimer?: NodeJS.Timeout;

    /**
     * Registers a transaction and returns the URL to open. Starts the listener
     * on first use — an MCP server that never does a DEX swap never opens a port.
     */
    async request(
        houdiniId: string,
        tx: SignableTransaction,
        chainId: number,
        expiresAt: number,
        order: OrderFacts = {},
    ): Promise<PendingSignature & { url: string }> {
        // 32 bytes: without the token the route 404s, so this is what stops
        // another local process from putting a transaction in front of the user.
        const token = randomBytes(32).toString("hex");
        const entry: PendingSignature = { token, houdiniId, tx, chainId, order, expiresAt, status: "pending" };
        this.pending.set(token, entry);

        const port = await this.ensureListening();
        return { ...entry, url: `http://${HOST}:${port}/sign/${token}` };
    }

    status(token: string): PendingSignature | undefined {
        const entry = this.pending.get(token);
        if (!entry) return undefined;
        if (entry.status === "pending" && Date.now() > entry.expiresAt) {
            entry.status = "expired";
        }
        return entry;
    }

    /** Exposed for tests and for a clean shutdown. */
    async close(): Promise<void> {
        if (this.sweepTimer) clearInterval(this.sweepTimer);
        this.sweepTimer = undefined;
        this.pending.clear();
        const server = this.server;
        this.server = undefined;
        this.port = undefined;
        if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    getPort(): number | undefined {
        return this.port;
    }

    private async ensureListening(): Promise<number> {
        if (this.port !== undefined) return this.port;

        const server = createServer((req, res) => this.handle(req, res));
        // Port 0 = whatever is free. A fixed port would collide with a second
        // MCP server, and there is no reason for this one to be predictable.
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, HOST, () => resolve());
        });
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("signing server failed to bind");

        this.server = server;
        this.port = address.port;
        // Do not hold the process open on this listener alone.
        server.unref();

        this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
        this.sweepTimer.unref();
        return this.port;
    }

    private sweep(): void {
        const now = Date.now();
        for (const [token, entry] of this.pending) {
            // Keep a resolved entry briefly so the agent's next poll can read it.
            const done = entry.status === "signed" || entry.status === "rejected";
            if (now > entry.expiresAt + (done ? 300_000 : 0)) this.pending.delete(token);
        }
        if (this.pending.size === 0) void this.close();
    }

    private handle(req: IncomingMessage, res: ServerResponse): void {
        this.sweep();

        const match = /^\/sign\/([0-9a-f]{64})$/.exec((req.url ?? "").split("?")[0]);
        if (!match) return this.notFound(res);

        const entry = this.pending.get(match[1]);
        // Unknown or expired tokens are indistinguishable from the outside.
        if (!entry || Date.now() > entry.expiresAt) return this.notFound(res);

        if (req.method === "GET") return this.servePage(res, entry);
        if (req.method === "POST") return this.acceptResult(req, res, entry);

        res.writeHead(405, { Allow: "GET, POST" }).end();
    }

    private servePage(res: ServerResponse, entry: PendingSignature): void {
        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            // Everything is inline; nothing may be fetched from anywhere else.
            "Content-Security-Policy":
                "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; form-action 'none'; frame-ancestors 'none'",
            "Referrer-Policy": "no-referrer",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        });
        res.end(renderSignPage(entry.tx, entry.chainId, entry.houdiniId, entry.token, entry.order));
    }

    private acceptResult(req: IncomingMessage, res: ServerResponse, entry: PendingSignature): void {
        // A browser will not send this content-type cross-origin without a
        // preflight, and no preflight is answered — so a hostile page cannot
        // resolve someone else's signing request even if it guessed the token.
        if (!(req.headers["content-type"] ?? "").includes("application/json")) {
            return this.json(res, 415, { error: "expected application/json" });
        }
        const origin = req.headers.origin;
        if (origin && origin !== `http://${HOST}:${this.port}`) {
            return this.json(res, 403, { error: "cross-origin request refused" });
        }
        if (entry.status !== "pending") {
            return this.json(res, 409, { error: `this request is already ${entry.status}` });
        }

        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
            if (body.length > 4096) req.destroy();
        });
        req.on("end", () => {
            let parsed: { txHash?: unknown; error?: unknown };
            try {
                parsed = JSON.parse(body);
            } catch {
                return this.json(res, 400, { error: "invalid JSON" });
            }

            if (typeof parsed.error === "string") {
                entry.status = "rejected";
                entry.error = parsed.error.slice(0, 300);
                return this.json(res, 200, { ok: true });
            }
            if (typeof parsed.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(parsed.txHash)) {
                return this.json(res, 400, { error: "txHash must be a 32-byte hex hash" });
            }

            entry.status = "signed";
            entry.txHash = parsed.txHash;
            this.json(res, 200, { ok: true });
        });
    }

    private notFound(res: ServerResponse): void {
        this.json(res, 404, { error: "not found" });
    }

    private json(res: ServerResponse, status: number, body: unknown): void {
        res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(body));
    }
}
