import { describe, it, expect, vi } from "vitest";
import { allowedHostnames, hostCheck } from "../src/host-check.js";

const run = (allowed: string[], host: string | undefined) => {
    const next = vi.fn();
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    hostCheck(allowed)({ headers: host === undefined ? {} : { host } } as never, res as never, next);
    return next.mock.calls.length === 1 ? "next" : res.status.mock.calls[0]?.[0];
};

describe("allowedHostnames", () => {
    it("answers to the loopback names by default", () => {
        expect(allowedHostnames("127.0.0.1", undefined)).toEqual(["localhost", "127.0.0.1", "[::1]"]);
    });

    it("adds the configured bind host", () => {
        expect(allowedHostnames("mcp.internal", undefined)).toContain("mcp.internal");
        expect(allowedHostnames("10.0.0.5", undefined)).toContain("10.0.0.5");
        expect(allowedHostnames("::1", undefined)).toContain("[::1]");
    });

    it("adds the listed hosts", () => {
        expect(allowedHostnames("127.0.0.1", " Proxy.Example , other.example")).toEqual(
            expect.arrayContaining(["proxy.example", "other.example"]),
        );
    });

    it("makes no check on a wildcard bind with nothing listed", () => {
        expect(allowedHostnames("0.0.0.0", undefined)).toBeUndefined();
        expect(allowedHostnames("::", "")).toBeUndefined();
    });

    it("checks a wildcard bind once hosts are listed", () => {
        expect(allowedHostnames("0.0.0.0", "proxy.example")).toEqual(["localhost", "127.0.0.1", "[::1]", "proxy.example"]);
    });
});

describe("hostCheck", () => {
    const allowed = allowedHostnames("127.0.0.1", undefined)!;

    it("lets loopback names through, with or without a port", () => {
        expect(run(allowed, "127.0.0.1:8080")).toBe("next");
        expect(run(allowed, "localhost")).toBe("next");
        expect(run(allowed, "LOCALHOST:3000")).toBe("next");
        expect(run(allowed, "[::1]:8080")).toBe("next");
    });

    it("refuses another name pointed at this machine", () => {
        expect(run(allowed, "attacker.example:8080")).toBe(403);
        expect(run(allowed, "localhost.attacker.example")).toBe(403);
    });

    it("refuses a missing or unparseable Host", () => {
        expect(run(allowed, undefined)).toBe(403);
        expect(run(allowed, "bad host")).toBe(403);
    });
});
