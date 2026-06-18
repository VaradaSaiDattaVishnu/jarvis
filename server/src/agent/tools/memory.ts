import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { rememberFact, recallFacts } from "../../memory/store";

/**
 * Long-term memory exposed as two tools. This is the LONG-TERM half of memory
 * (durable facts across conversations) — distinct from the conversation
 * checkpointer in agent.ts, which is the SHORT-TERM, per-thread history.
 */

export const rememberFactTool = tool(
  async ({ fact }) => {
    rememberFact(fact);
    return `Got it — I'll remember that: "${fact}".`;
  },
  {
    name: "remember_fact",
    description:
      "Save a durable fact about the user (their name, preferences, important details) so you can recall it in future conversations. Use this whenever the user shares something worth remembering long-term.",
    schema: z.object({
      fact: z.string().describe("The fact to remember, as a short sentence"),
    }),
  },
);

export const recallFactsTool = tool(
  async () => {
    const facts = recallFacts();
    if (facts.length === 0) return "I don't have any saved facts about the user yet.";
    return "Here is what I remember about the user:\n" + facts.map((f) => `- ${f}`).join("\n");
  },
  {
    name: "recall_facts",
    description:
      "Retrieve everything you've saved about the user. Use this to personalize an answer, or when the user asks what you remember about them.",
    schema: z.object({}),
  },
);
