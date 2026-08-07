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
/**
 * How long an entry outlives its expiry. A signature that is already on chain
 * has to be recordable even though the quote it came from has lapsed — the
 * chain does not care about our expiry, and losing the hash sends the user off
 * to pay for a second swap they have already made.
 */
const GRACE_MS = 300_000;

export class SigningServer {
    private server?: Server;
    private port?: number;
    private readonly pending = new Map<string, PendingSignature>();
    private sweepTimer?: NodeJS.Timeout;
    private listening?: Promise<number>;

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
        // Memoised, because the check above and the bind below are separated by
        // an await. Two dexSignRequest calls in flight together — which MCP
        // clients issue routinely — both saw no port and both bound. Only the
        // second was kept in this.port; the first stayed listening and served
        // its page, but the Origin check compares against this.port, so that
        // page's own report POST came back 403. The user signed, the funds
        // moved, and the status stayed "pending" forever.
        this.listening ??= this.startListener().finally(() => {
            this.listening = undefined;
        });
        return this.listening;
    }

    private async startListener(): Promise<number> {
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
            // The grace applies to expired entries too, not just resolved ones:
            // a user still in their wallet when the quote lapses needs to be
            // able to report the hash afterwards.
            if (now > entry.expiresAt + GRACE_MS) this.pending.delete(token);
        }
        if (this.pending.size === 0) void this.close();
    }

    private handle(req: IncomingMessage, res: ServerResponse): void {
        // This runs inside the HTTP request listener, so anything thrown here
        // is an uncaughtException and takes the whole MCP server down — every
        // tool, not just signing, plus the pending map, which is the only
        // record of a hash the user may already have broadcast. One malformed
        // order field used to be enough.
        try {
            this.route(req, res);
        } catch (err) {
            const why = err instanceof Error ? err.message : String(err);
            if (!res.headersSent) this.json(res, 500, { error: `could not render this request: ${why}` });
            else res.end();
        }
    }

    private route(req: IncomingMessage, res: ServerResponse): void {
        this.sweep();

        const match = /^\/sign\/([0-9a-f]{64})$/.exec((req.url ?? "").split("?")[0]);
        if (!match) return this.notFound(res);

        const entry = this.pending.get(match[1]);
        if (!entry) return this.notFound(res);

        // The page stops being served once the quote lapses — there is no point
        // offering a stale transaction to sign. A POST is still accepted during
        // the grace, because by then the user may already have broadcast.
        const expired = Date.now() > entry.expiresAt;
        if (req.method === "GET") {
            if (expired) return this.notFound(res);
            return this.servePage(res, entry);
        }
        if (req.method === "POST") return this.acceptResult(req, res, entry);

        res.writeHead(405, { Allow: "GET, POST" }).end();
    }

    private servePage(res: ServerResponse, entry: PendingSignature): void {
        // Rendered before the status line is written. Doing it the other way
        // round meant a throw during rendering left a 200 already on the wire,
        // so the handler's catch could only end the response — the client got
        // an empty page that claimed success.
        const html = renderSignPage(entry.tx, entry.chainId, entry.houdiniId, entry.token, entry.order);
        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            // Everything is inline; nothing may be fetched from anywhere else.
            "Content-Security-Policy":
                "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; form-action 'none'; frame-ancestors 'none'",
            "Referrer-Policy": "no-referrer",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        });
        res.end(html);
    }

    private acceptResult(req: IncomingMessage, res: ServerResponse, entry: PendingSignature): void {
        // A browser will not send this content-type cross-origin without a
        // preflight, and no preflight is answered — so a hostile page cannot
        // resolve someone else's signing request even if it guessed the token.
        if (!(req.headers["content-type"] ?? "").includes("application/json")) {
            return this.json(res, 415, { error: "expected application/json" });
        }
        // Against the port this request actually arrived on. Using this.port
        // mis-rejects a page served by an earlier listener, and requiring the
        // header rather than only checking it when present matches what
        // docs/local-signing.md claims: the page always sends one.
        const origin = req.headers.origin;
        const expected = `http://${HOST}:${req.socket.localPort}`;
        if (origin !== expected) {
            return this.json(res, 403, { error: "cross-origin request refused" });
        }
        if (entry.status !== "pending" && entry.status !== "expired") {
            return this.json(res, 409, { error: `this request is already ${entry.status}` });
        }

        let body = "";
        let tooBig = false;
        req.on("data", (chunk) => {
            if (tooBig) return;
            body += chunk;
            if (body.length > 4096) {
                // Answer before hanging up. Destroying the socket meant 'end'
                // never fired and nothing was ever sent, so the page's report()
                // swallowed a socket error and the agent polled a request that
                // stayed pending forever. Reachable without an attacker: a
                // wallet revert blob longer than 4KB.
                tooBig = true;
                this.json(res, 413, { error: "body too large" });
                req.destroy();
            }
        });
        req.on("end", () => {
            if (tooBig) return;
            // Checked again here, not only above. The check above runs when the
            // headers arrive; the entry is not mutated until the body finishes.
            // Send several sets of headers before any body and every request
            // passes that first check, so all of them are accepted and the last
            // hash wins — single use in name only. Nothing awaits between this
            // test and the assignments below, so together they are atomic.
            if (entry.status !== "pending" && entry.status !== "expired") {
                return this.json(res, 409, { error: `this request is already ${entry.status}` });
            }

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
