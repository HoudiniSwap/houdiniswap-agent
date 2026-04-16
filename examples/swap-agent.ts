/**
 * Example: HoudiniSwap AI Swap Agent
 *
 * A complete AI agent that can search tokens, get quotes, and execute swaps
 * using the Vercel AI SDK v6 and HoudiniSwap tools.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... WALLET_KEY=0x... npx tsx examples/swap-agent.ts "Swap 0.1 BTC to ETH"
 */

import { createHoudiniTools } from "@houdiniswap/ai-tools";
import { ToolLoopAgent, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

const WALLET_KEY = process.env.WALLET_KEY;
if (!WALLET_KEY) {
    console.error("Usage: WALLET_KEY=0x... npx tsx examples/swap-agent.ts \"<prompt>\"");
    process.exit(1);
}

const prompt = process.argv[2] || "What tokens are available on Bitcoin?";

// Support both standard API keys and OAuth access tokens (sk-ant-oat01-*)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;
const anthropic = createAnthropic(
    ANTHROPIC_AUTH_TOKEN
        ? {
              apiKey: "oauth",
              headers: { Authorization: `Bearer ${ANTHROPIC_AUTH_TOKEN}`, "anthropic-beta": "oauth-2025-04-20" },
          }
        : { apiKey: ANTHROPIC_API_KEY },
);

const tools = createHoudiniTools({
    auth: { type: "x402", privateKey: WALLET_KEY as `0x${string}` },
});

const agent = new ToolLoopAgent({
    model: anthropic("claude-sonnet-4-6"),
    tools,
    instructions: `You are a crypto swap assistant powered by HoudiniSwap.
You help users swap cryptocurrencies across 14 CEXes and 20+ DEXes.

Capabilities:
- Search tokens by symbol, chain, or address (getTokens)
- List supported blockchains (getChains)
- Get swap quotes from multiple providers (getQuote)
- Create swap orders (createExchange)
- Track order status (getOrder)
- Execute end-to-end swaps (swap)

Guidelines:
- Always show the user the quote details (rate, estimated output, provider) before creating an exchange
- Use token IDs (from getTokens) for quotes and exchanges, not symbols
- For simple swaps, use the "swap" composite tool
- Mention the deposit address clearly when an exchange is created
- If a quote fails, suggest adjusting the amount or trying a different pair`,
    stopWhen: stepCountIs(10),
});

console.log(`\nPrompt: ${prompt}\n`);

const { text } = await agent.generate({ prompt });

console.log(`\nAgent response:\n${text}\n`);
