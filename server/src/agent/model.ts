import { ChatAnthropic } from "@langchain/anthropic";
import { env } from "../config/env";

/**
 * Build the Claude chat model that powers the agent's reasoning.
 *
 * We chose Haiku 4.5 (`claude-haiku-4-5`) for the fastest, cheapest responses —
 * the right call for a latency-sensitive voice assistant. A nice side effect:
 * unlike Opus 4.8, Haiku 4.5 still accepts sampling params like `temperature`,
 * so we don't have to strip them to avoid a 400.
 *
 * We pass the API key explicitly from our validated `env` rather than relying on
 * LangChain's implicit ANTHROPIC_API_KEY lookup — it keeps the dependency obvious
 * and routes through our fail-fast check.
 *
 * `maxTokens` is small (1024) on purpose: spoken replies are short, and a tight
 * cap keeps latency and cost down.
 */
export function createChatModel() {
  return new ChatAnthropic({
    model: "claude-haiku-4-5",
    apiKey: env.anthropicApiKey,
    maxTokens: 1024,
  });
}
