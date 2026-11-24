// Turns `npm audit --json` output into a job-summary table (HS-2658).
// Usage: node audit-summary.mjs "<heading>" <audit.json>
import { readFileSync } from "node:fs";

const [heading, file] = process.argv.slice(2);
console.log(`### ${heading}\n`);

let report;
try {
    report = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
    console.log(`npm audit produced no report (${err.message}); see the step log.\n`);
    process.exit(0);
}
if (report.error) {
    console.log(`npm audit failed: ${report.error.summary ?? report.error.code}\n`);
    process.exit(0);
}

const counts = report.metadata?.vulnerabilities ?? {};
console.log("| Severity | Count |\n|---|---|");
for (const level of ["critical", "high", "moderate", "low"]) {
    console.log(`| ${level} | ${counts[level] ?? 0} |`);
}
const serious = Object.values(report.vulnerabilities ?? {})
    .filter((v) => v.severity === "critical" || v.severity === "high")
    .map((v) => `- \`${v.name}\` (${v.severity})`)
    .sort();
if (serious.length) {
    console.log("\n<details><summary>Critical and high packages</summary>\n");
    console.log(serious.join("\n"));
    console.log("\n</details>");
}
console.log("");
