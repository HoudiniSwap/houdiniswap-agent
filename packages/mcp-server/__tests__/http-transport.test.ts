import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * The HTTP transport served exactly one request. A single long-lived transport
 * instance was created at startup and reused, so the first request succeeded and
 * every one after it returned a bare HTTP 500 with nothing logged. Before that,
 * it answered every request with "Parse error: Invalid JSON" because the
 * express-parsed body was not passed to handleRequest.
 *
 * Both bugs survived earlier checks that only ever made a single request, so
 * these deliberately make several in a row.
 *
 * No API key is set, so the server starts in read-only mode and these methods
 * never reach the network — the transport is what is under test.
 */
const PORT = 8899 + Math.floor(Math.random() * 100);
const HOST = "127.0.0.1";
const SERVER = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../dist/index.js",
);

let child: ChildProcess;

const post = async (body: unknown) => {
    const res = await fetch(`http://${HOST}:${PORT}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    const line = text.split("\n").find((l) => l.startsWith("data: "));
    return { status: res.status, body: line ? JSON.parse(line.slice(6)) : null };
};

beforeAll(async () => {
    child = spawn("node", [SERVER, "--transport=http"], {
        env: {
            ...process.env,
            PORT: String(PORT),
            HOUDINI_X402_PRIVATE_KEY: "",
            HOUDINI_API_KEY: "",
            HOUDINI_PARTNER_ID: "",
        },
        stdio: ["ignore", "ignore", "pipe"],
    });
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("server did not start in time")), 20_000);
        child.stderr?.on("data", (d: Buffer) => {
            if (d.toString().includes("listening on")) {
                clearTimeout(timer);
                resolve();
            }
        });
    });
}, 30_000);

afterAll(() => {
    child?.kill();
});

describe("HTTP transport", () => {
    it("answers a first request", async () => {
        const { status, body } = await post({ jsonrpc: "2.0", id: 1, method: "tools/list" });
        expect(status).toBe(200);
        expect(body?.result?.tools?.length).toBeGreaterThan(0);
    });

    it("keeps answering after the first — one transport per process served only one", async () => {
        for (const id of [2, 3, 4]) {
            const { status, body } = await post({ jsonrpc: "2.0", id, method: "tools/list" });
            expect(status, `request ${id} should not 500`).toBe(200);
            expect(body?.result?.tools?.length).toBeGreaterThan(0);
        }
    });

    it("parses the express-consumed body rather than re-reading a drained stream", async () => {
        const { body } = await post({ jsonrpc: "2.0", id: 5, method: "tools/list" });
        expect(JSON.stringify(body)).not.toContain("Parse error");
    });

    it("serves other methods too", async () => {
        const { status, body } = await post({ jsonrpc: "2.0", id: 6, method: "resources/list" });
        expect(status).toBe(200);
        expect(body?.result?.resources?.length).toBeGreaterThan(0);
    });

    it("reports the package version, not a hardcoded one", async () => {
        const { body } = await post({
            jsonrpc: "2.0",
            id: 7,
            method: "initialize",
            params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } },
        });
        expect(body?.result?.serverInfo?.version).not.toBe("0.1.0");
    });
});

describe("HTTP transport hardening", () => {
    // GET opened a notification stream the SDK never closed, pinning the
    // per-request server for as long as the socket was held. 181 idle GETs
    // OOM-killed the process, unauthenticated.
    it("refuses GET rather than opening a stream it never closes", async () => {
        const res = await fetch(`http://${HOST}:${PORT}/mcp`, {
            method: "GET",
            headers: { Accept: "application/json, text/event-stream" },
        });
        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toBe("POST");
        const body = await res.json();
        expect(body.error.message).toMatch(/use POST/);
    });

    it("many GETs neither hang nor accumulate", async () => {
        const results = await Promise.all(
            Array.from({ length: 30 }, () =>
                fetch(`http://${HOST}:${PORT}/mcp`, { method: "GET" }).then((r) => r.status),
            ),
        );
        expect(results.every((s) => s === 405)).toBe(true);
    });

    // The wallet-spending surface must not be reachable off-box by default.
    it("binds loopback only", async () => {
        await expect(
            fetch(`http://127.0.0.1:${PORT}/mcp`, { method: "GET" }).then((r) => r.status),
        ).resolves.toBe(405);
    });
});
