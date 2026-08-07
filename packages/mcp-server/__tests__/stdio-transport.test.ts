import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * stdio is the default transport and what every MCP client actually uses — the
 * plugin, Claude Desktop, Cursor. It had no test: a mutation forcing the
 * transport to always be http survived the entire suite.
 *
 * No API key is set, so nothing here reaches the network.
 */
const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/index.js");

let child: ChildProcess;
let buffer = "";
const pending = new Map<number, (m: Record<string, unknown>) => void>();

const rpc = (method: string, params?: unknown) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
        const id = Math.floor(Math.random() * 1e6);
        pending.set(id, resolve);
        child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
        setTimeout(() => { if (pending.delete(id)) reject(new Error(`timeout: ${method}`)); }, 15_000);
    });

beforeAll(async () => {
    child = spawn("node", [SERVER], {
        env: { ...process.env, HOUDINI_X402_PRIVATE_KEY: "", HOUDINI_API_KEY: "", HOUDINI_PARTNER_ID: "" },
        stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout?.on("data", (d: Buffer) => {
        buffer += d.toString();
        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            try {
                const msg = JSON.parse(line) as { id?: number };
                const r = msg.id !== undefined ? pending.get(msg.id) : undefined;
                if (r && msg.id !== undefined) { pending.delete(msg.id); r(msg as Record<string, unknown>); }
            } catch { /* not JSON */ }
        }
    });
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("stdio server did not become ready")), 20_000);
        child.stderr?.on("data", (d: Buffer) => {
            if (d.toString().includes("stdio) ready")) { clearTimeout(timer); resolve(); }
        });
    });
}, 30_000);

afterAll(() => { child?.kill(); });

describe("stdio transport", () => {
    it("is the default when no --transport flag is given", async () => {
        const res = await rpc("initialize", {
            protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" },
        });
        const info = (res.result as { serverInfo?: { name?: string; version?: string } })?.serverInfo;
        expect(info?.name).toBe("houdiniswap");
        expect(info?.version).not.toBe("0.1.0");
    });

    it("lists every tool over stdio", async () => {
        const res = await rpc("tools/list");
        const tools = (res.result as { tools?: Array<{ name: string }> })?.tools ?? [];
        expect(tools.length).toBeGreaterThanOrEqual(13);
        for (const expected of ["getTokens", "getChains", "getQuote", "createExchange", "swap"]) {
            expect(tools.map((t) => t.name)).toContain(expected);
        }
    });

    it("serves repeated requests on one long-lived connection", async () => {
        for (let i = 0; i < 4; i++) {
            const res = await rpc("tools/list");
            expect((res.result as { tools?: unknown[] })?.tools?.length).toBeGreaterThan(0);
        }
    });

    it("exposes its resources over stdio", async () => {
        const res = await rpc("resources/list");
        const uris = ((res.result as { resources?: Array<{ uri: string }> })?.resources ?? []).map((r) => r.uri);
        expect(uris).toContain("houdiniswap://pricing");
        expect(uris).toContain("houdiniswap://openapi");
    });

    it("stays alive after an erroring call", async () => {
        await rpc("tools/call", { name: "getOrder", arguments: { houdiniId: "nope" } }).catch(() => undefined);
        const res = await rpc("tools/list");
        expect((res.result as { tools?: unknown[] })?.tools?.length).toBeGreaterThan(0);
    });
});
