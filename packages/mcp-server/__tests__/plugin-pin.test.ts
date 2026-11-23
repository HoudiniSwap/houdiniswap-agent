import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The plugin runs `npx -y @houdiniswap/mcp-server@<pin>`, so plugin users get
 * exactly that version. A pin left behind fails silently: they keep the old
 * server. This fails every release PR until the pin is bumped with it.
 */
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

describe("plugin manifest", () => {
    it("pins the MCP server to this package's version", () => {
        const plugin = readJson("../../../plugins/houdiniswap/.claude-plugin/plugin.json");
        const { version } = readJson("../package.json");
        const spec = (plugin.mcpServers.houdiniswap.args as string[]).find((a) =>
            a.startsWith("@houdiniswap/mcp-server"),
        );
        expect(spec, "plugin.json must pin @houdiniswap/mcp-server@<version>").toBe(
            `@houdiniswap/mcp-server@${version}`,
        );
    });
});
