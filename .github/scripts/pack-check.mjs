// Fails when an npm package would publish files it should not (HS-2658).
// Usage: node pack-check.mjs <npm pack --json output>
// Only package.json, README, LICENSE and the built dist/ may ship, and no
// tests, env files, keys or local config even inside dist/.
import { readFileSync } from "node:fs";

const ALLOWED = /^(package\.json|README\.md|LICENSE(\.[a-z]+)?|dist\/.+)$/;
const FORBIDDEN = /(^|\/)(__tests__|tests?|fixtures)\/|\.(test|spec)\.[cm]?[jt]s(\.map)?$|(^|\/)\.env|(^|\/)\.npmrc$|\.(pem|key|p12)$|(^|\/)tsconfig[^/]*\.json$/;

const packs = JSON.parse(readFileSync(process.argv[2], "utf8"));
let failed = false;
for (const pack of packs) {
    const bad = pack.files.map((f) => f.path).filter((p) => !ALLOWED.test(p) || FORBIDDEN.test(p));
    console.log(`${pack.name}@${pack.version}: ${pack.files.length} files, ${(pack.size / 1024).toFixed(1)} kB packed`);
    if (!pack.files.some((f) => f.path.startsWith("dist/"))) {
        console.log(`::error::${pack.name} would publish no dist/ files; was it built?`);
        failed = true;
    }
    for (const p of bad) {
        console.log(`::error::${pack.name} would publish ${p}`);
        failed = true;
    }
}
process.exit(failed ? 1 : 0);
