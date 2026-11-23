// Fails when a PR adds a dependency that runs an install script (HS-2658).
// These packages run on users' machines next to their wallet keys, so a new
// install script needs a deliberate review: add `name` to
// .github/allowed-install-scripts.txt in a separate PR (the check reads the
// base branch's copy, so a PR cannot allow its own).
// Usage: node install-scripts.mjs <base lockfile> <head lockfile> [allowlist]
import { existsSync, readFileSync } from "node:fs";

const load = (file) => {
    try {
        return JSON.parse(readFileSync(file, "utf8")).packages ?? {};
    } catch {
        return {};
    }
};
const withScripts = (packages) =>
    new Map(
        Object.entries(packages)
            .filter(([path, p]) => path && p.hasInstallScript)
            .map(([path, p]) => [path.replace(/^.*node_modules\//, ""), p.version]),
    );

const [baseFile, headFile, allowFile] = process.argv.slice(2);
const base = withScripts(load(baseFile));
const head = withScripts(load(headFile));
const allowed = new Set(
    allowFile && existsSync(allowFile)
        ? readFileSync(allowFile, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
        : [],
);

const added = [...head].filter(([name]) => !base.has(name) && !allowed.has(name));
console.log(`Packages with install scripts: ${head.size} (${[...head.keys()].join(", ") || "none"})`);
for (const [name, version] of added) {
    console.log(`::error::New dependency with an install script: ${name}@${version}`);
}
process.exit(added.length ? 1 : 0);
