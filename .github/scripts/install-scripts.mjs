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
// check. So does a lockfile entry whose name, version or integrity does not
// match the registry tarball it points to.
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

// Identity comes from the tarball URL npm will download, not from the lockfile
// key or its `name` field: https://registry.npmjs.org/<name>/-/<base>-<version>.tgz
const TARBALL = /^\/((?:@[a-z0-9][a-z0-9._~-]*\/)?([a-z0-9][a-z0-9._~-]*))\/-\/([a-z0-9][a-z0-9._~-]*)-(\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?(?:\+[0-9a-z.-]+)?)\.tgz$/i;
const fromRegistry = (resolved, version) => {
    let url;
    try {
        url = new URL(resolved);
    } catch {
        return null;
    }
    if (url.protocol !== "https:" || url.host !== "registry.npmjs.org" || url.search || url.hash) return null;
    const m = TARBALL.exec(url.pathname);
    if (!m || m[3] !== m[2] || m[4] !== version || m[1].includes("..")) return null;
    return m[1];
};

const entries = (packages) =>
    Object.entries(packages)
        .filter(([path, p]) => path.includes("node_modules/") && !p.link)
        .map(([path, p]) => ({
            path,
            name: fromRegistry(p.resolved ?? "", p.version),
            version: p.version,
            resolved: p.resolved,
            integrity: p.integrity,
            flagged: Boolean(p.hasInstallScript),
        }));

const base = entries(load(baseFile, false));
const head = entries(load(headFile, true));
const allowed = new Set(
    allowFile && existsSync(allowFile)
        ? readFileSync(allowFile, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
        : [],
);

const baseIds = new Set(base.map((e) => `${e.resolved}|${e.integrity}`));
const baseWithScripts = new Set(base.filter((e) => e.flagged && e.name).map((e) => e.name));
const changed = head.filter((e) => !baseIds.has(`${e.resolved}|${e.integrity}`));

const errors = [];
const hasScript = async (e) => {
    if (!e.name) {
        errors.push(`${e.path} does not resolve to an npm registry tarball for its version (${e.resolved ?? "no resolved URL"})`);
        return e.flagged;
    }
    if (!e.integrity) {
        errors.push(`${e.name}@${e.version} has no integrity hash in the lockfile`);
        return e.flagged;
    }
    const url = `${REGISTRY}${e.name.replace("/", "%2F")}/${encodeURIComponent(e.version)}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const doc = await res.json();
            if (doc.dist?.integrity !== e.integrity) {
                errors.push(`${e.name}@${e.version}: lockfile integrity does not match the registry`);
                return true;
            }
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
