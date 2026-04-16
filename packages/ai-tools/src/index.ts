import { HoudiniClient, type HoudiniConfig } from "@houdiniswap/agent-shared";
import { createTools } from "./tools.js";

export type { HoudiniConfig } from "@houdiniswap/agent-shared";
export { HoudiniClient } from "@houdiniswap/agent-shared";

/**
 * Create HoudiniSwap AI SDK tools for use with streamText, generateText, or ToolLoopAgent.
 *
 * @example
 * ```ts
 * import { createHoudiniTools } from "@houdiniswap/ai-tools";
 * import { streamText, stepCountIs } from "ai";
 *
 * const tools = createHoudiniTools({
 *     auth: { type: "x402", privateKey: "0x..." },
 * });
 *
 * const result = await streamText({
 *     model: "anthropic/claude-sonnet-4.6",
 *     tools,
 *     prompt: "Swap 0.1 BTC to ETH, send to 0x742d...",
 *     stopWhen: stepCountIs(10),
 * });
 * ```
 */
export const createHoudiniTools = (config: HoudiniConfig) => {
    const client = new HoudiniClient(config);
    return createTools(client);
};

export { createTools } from "./tools.js";
export * from "./schemas.js";
