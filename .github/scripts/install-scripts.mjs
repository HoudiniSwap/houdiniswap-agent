// Fails when a PR adds a dependency that runs an install script (HS-2658).
// These packages run on users' machines next to their wallet keys, so a new
// install script needs a deliberate review: add the package name to
// .github/allowed-install-scripts.txt in a separate PR (the check reads the
// base branch's copy, so a PR cannot allow its own).
//
// The lockfile's own `hasInstallScript` flag comes from the PR, so it is not
// trusted alone: every package that is new or changed in the head lockfile is
// looked up on the npm registry (install/preinstall/postinstall scripts, or a
// binding.gyp that npm builds on install). A lookup that fails, a lockfile
// that does not parse, or a dependency from outside the registry fails the
// check.
// Usage: node install-scripts.mjs <base lockfile> <head lockfile> [allowlist]
import { existsSync, readFileSync } from "node:fs";

const REGISTRY = "https://registry.npmjs.org/";
const [baseFile, headFile, allowFile] = process.argv.slice(2);

const load = (file, required) => {
    try {
        return JSON.parse(readFileSync(file, "utf8")).packages ?? {};
    } catch (err) {
        if (required) {
            console.log(`::error::Cannot read ${file}: ${err.message}`);
            process.exit(1);
        }
        return {};
    }
};

// Real package identity: `name` is set for aliased installs (npm:pkg@x).
const entries = (packages) =>
    Object.entries(packages)
        .filter(([path, p]) => path.includes("node_modules/") && !p.link)
        .map(([path, p]) => ({
            name: p.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length),
            version: p.version,
            resolved: p.resolved,
            flagged: Boolean(p.hasInstallScript),
        }));

const base = entries(load(baseFile, false));
const head = entries(load(headFile, true));
const allowed = new Set(
    allowFile && existsSync(allowFile)
        ? readFileSync(allowFile, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
        : [],
);

const baseIds = new Set(base.map((e) => `${e.name}@${e.version}|${e.resolved}`));
const baseWithScripts = new Set(base.filter((e) => e.flagged).map((e) => e.name));
const changed = head.filter((e) => !baseIds.has(`${e.name}@${e.version}|${e.resolved}`));

const errors = [];
const hasScript = async (e) => {
    if (!e.resolved || !e.resolved.startsWith(REGISTRY)) {
        errors.push(`${e.name}@${e.version} does not come from the npm registry (${e.resolved ?? "no resolved URL"})`);
        return e.flagged;
    }
    const url = `${REGISTRY}${e.name.replace("/", "%2F")}/${encodeURIComponent(e.version)}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const doc = await res.json();
            const scripts = doc.scripts ?? {};
            return e.flagged || Boolean(scripts.preinstall || scripts.install || scripts.postinstall || doc.gypfile);
        } catch (err) {
            if (attempt === 3) errors.push(`registry lookup failed for ${e.name}@${e.version}: ${err.message}`);
        }
    }
    return true;
};

const results = [];
for (let i = 0; i < changed.length; i += 16) {
    const batch = changed.slice(i, i + 16);
    results.push(...(await Promise.all(batch.map(async (e) => ({ ...e, script: await hasScript(e) })))));
}

const withScripts = results.filter((r) => r.script);
const blocked = withScripts.filter((r) => !baseWithScripts.has(r.name) && !allowed.has(r.name));
const updated = withScripts.filter((r) => baseWithScripts.has(r.name) || allowed.has(r.name));

console.log(`New or changed packages: ${changed.length}; with install scripts: ${withScripts.length}`);
for (const r of updated) console.log(`· ${r.name}@${r.version} runs an install script (already reviewed)`);
for (const r of blocked) console.log(`::error::New dependency with an install script: ${r.name}@${r.version}`);
for (const msg of errors) console.log(`::error::${msg}`);
process.exit(blocked.length || errors.length ? 1 : 0);
