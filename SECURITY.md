# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability** ([direct link](https://github.com/HoudiniSwap/houdiniswap-agent/security/advisories/new)). Do not open a public issue or pull request for a vulnerability.

Include the affected package and version, the setup it needs (for example `--transport=http` or an x402 wallet key), the steps to reproduce, and what an attacker gains. We will acknowledge the report, keep you updated while we work on a fix, and credit you in the advisory if you want.

When testing, use your own wallets and keys, and do not run tests that move other people's funds or disrupt the HoudiniSwap API.

## Supported versions

Fixes go into the latest release of each package. Please check that the issue still exists in the latest version before reporting.

| Package | Supported |
|---|---|
| `@houdiniswap/mcp-server` | latest release |
| `@houdiniswap/agent-shared` | latest release |
| `@houdiniswap/ai-tools` | latest release |
| Claude Code plugin (`plugins/houdiniswap`) | latest release |

## Scope

In scope: the code in this repository, including the local signing page, the x402 payment client, the stdio and HTTP transports, the plugin and its skill.

Out of scope here: the HoudiniSwap API and website themselves. You can still use the private report link above for them, and we will route the report.
