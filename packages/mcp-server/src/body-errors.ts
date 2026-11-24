import type { ErrorRequestHandler } from "express";

/**
 * Answers a body express.json() refused as a JSON-RPC error.
 *
 * Those errors are raised before any route runs, so without this express's
 * default handler answered with an HTML page that, outside
 * NODE_ENV=production, carried the stack trace and the absolute paths of this
 * machine's files.
 */
export const jsonBodyErrors: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    console.error(`MCP request rejected: ${err instanceof Error ? err.message : String(err)}`);
    const status: number = typeof err?.status === "number" && err.status >= 400 && err.status < 500 ? err.status : 500;
    const error =
        err?.type === "entity.parse.failed"
            ? { code: -32700, message: "Parse error: the request body is not valid JSON." }
            : err?.type === "entity.too.large"
              ? { code: -32600, message: "Invalid request: the request body is too large." }
              : status < 500
                ? { code: -32600, message: "Invalid request." }
                : { code: -32603, message: "Internal server error." };
    res.status(status).json({ jsonrpc: "2.0", error, id: null });
};
