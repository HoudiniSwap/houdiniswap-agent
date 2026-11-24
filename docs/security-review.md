# Security review

## When a PR needs one

A pull request needs a security review before merge when it touches any of:

- `packages/mcp-server/src/signing/` or the signing tools (`dexSignRequest`, `cexDepositRequest`)
- `packages/shared/src/x402.ts` or anything else that signs or pays
- `packages/mcp-server/src/index.ts`, the HTTP transport or the host check
- `packages/shared/src/client.ts` (auth headers, redirects, timeouts)
- the `swap` composite flow (`packages/mcp-server/src/tools/swap-flow.ts` and `packages/ai-tools/src/tools.ts`)
- the plugin manifest or skill (`plugins/houdiniswap/`)
- `.github/` (workflows, the scan scripts and `allowed-install-scripts.txt`)
- a new dependency, especially one with an install script

The reviewer goes through the checklist below and says in the review which items they checked. The Security Scan workflow runs on every PR, but it only catches leaked secrets, known-bad code patterns and workflow mistakes; it does not catch logic bugs like the ones below.

## Checklist

1. **Who can call it?** Can a web page, another local process or a hostile API response reach this code? HTTP endpoints must check the Host header (DNS rebinding) and must not bind to `0.0.0.0` by default.
2. **What gets signed or paid?** Everything signed must be checked against what the user asked for: recipient, amount, token, chain. Never sign a value only because the API returned it.
3. **Where does the money go?** Payments go only to known addresses, within the per-session budget, at most once per call.
4. **What happens on retry, reload or a second tab?** A signing link or payment must not be usable twice. A failure after payment must not look like "nothing happened", or the agent will pay again.
5. **What does the agent see?** Errors and tool results must not include keys, full API secrets or text an API response could use to instruct the model.
6. **New dependencies.** They run on users' machines next to their wallet keys: is the package needed, maintained, and free of install scripts? An install script needs an entry in `.github/allowed-install-scripts.txt`, added in its own PR.
7. **Old versions.** If the fix matters for users, it needs a release, and old affected versions may need `npm deprecate`.

## Running the scanners locally

The Security Scan workflow (`.github/workflows/security-scan.yml`) runs these on a PR. To run them before pushing:

```bash
gitleaks git --log-opts="origin/main..HEAD" --config .gitleaks.toml
semgrep scan --config p/typescript --config p/nodejs --config p/secrets --baseline-commit origin/main
actionlint .github/workflows/*.yml
zizmor .github/workflows/
npm audit --omit=dev
npx turbo run build && (cd packages/mcp-server && npm pack --dry-run)   # what npm would publish
```
