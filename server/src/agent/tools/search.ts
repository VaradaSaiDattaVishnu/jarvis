import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { env } from "../../config/env";

/**
 * A REAL external-API tool that needs a key (Tavily web search).
 *
 * Note the GRACEFUL DEGRADATION: if TAVILY_API_KEY isn't set, we return a clear
 * message instead of throwing. The server still boots and every other tool keeps
 * working — only this one is unavailable. We call Tavily with native `fetch` so
 * the request/response shape is fully visible (no SDK wrapper to learn).
 */
export const search = tool(
  async ({ query }) => {
    if (!env.tavilyApiKey) {
      return "Web search is not configured (TAVILY_API_KEY is missing).";
    }

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: env.tavilyApiKey,
        query,
        max_results: 3,
        search_depth: "basic",
      }),
    });
    if (!res.ok) return `Web search failed (HTTP ${res.status}).`;

    // Node's fetch types json() as `unknown`, so assert the shape we rely on.
    const data = (await res.json()) as {
      results?: Array<{ title: string; url: string; content: string }>;
    };
    const results = data.results ?? [];
    if (results.length === 0) return `No results found for "${query}".`;

    // Compact the top hits into text the model can read and cite.
    return results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content}`)
      .join("\n\n");
  },
  {
    name: "search",
    description:
      "Search the web for current information — news, recent events, or anything that may have changed recently or isn't common knowledge.",
    schema: z.object({
      query: z.string().describe("The search query"),
    }),
  },
);
