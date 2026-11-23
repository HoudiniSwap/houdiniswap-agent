import type { RequestHandler } from "express";

const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];
const WILDCARD_HOSTS = ["0.0.0.0", "::", "[::]"];

/**
 * The hostnames `/mcp` answers to, or undefined when it answers to any.
 *
 * A web page can point a domain it controls at 127.0.0.1 and then call this
 * server from the visitor's browser; the Host header still names that domain.
 * Answering only to the names this server is reached by closes that. They are
 * the loopback names, the bind address (HOUDINI_HTTP_HOST) and any listed in
 * HOUDINI_HTTP_ALLOWED_HOSTS, for a proxy that forwards another name.
 *
 * Bound to every interface with no list given, the name callers use is
 * unknown, so no check is made: that setup is already reachable by anyone and
 * has to sit behind an authenticating proxy.
 */
export const allowedHostnames = (bindHost: string, extra: string | undefined): string[] | undefined => {
    const listed = (extra ?? "")
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean);
    const host = bindHost.trim().toLowerCase();
    if (WILDCARD_HOSTS.includes(host)) return listed.length > 0 ? [...LOOPBACK_HOSTNAMES, ...listed] : undefined;
    const bound = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
    return [...new Set([...LOOPBACK_HOSTNAMES, bound, ...listed])];
};

/** Refuses a request whose Host header names none of `allowed`. */
export const hostCheck = (allowed: readonly string[]): RequestHandler => (req, res, next) => {
    let hostname: string | undefined;
    try {
        hostname = req.headers.host ? new URL(`http://${req.headers.host}`).hostname.toLowerCase() : undefined;
    } catch {
        hostname = undefined;
    }
    if (hostname && allowed.includes(hostname)) {
        next();
        return;
    }
    res.status(403).json({
        jsonrpc: "2.0",
        error: {
            code: -32000,
            message: `Host "${req.headers.host ?? ""}" is not served here. Set HOUDINI_HTTP_ALLOWED_HOSTS to add a name.`,
        },
        id: null,
    });
};
