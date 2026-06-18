import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { rememberFact } from "../../memory/store";

/**
 * Long-term memory: durable facts across conversations — distinct from the
 * conversation checkpointer in agent.ts, which is the SHORT-TERM, per-thread
 * history. Only the *save* side is a tool (remember_fact); *recall* is always-on,
 * injected into the system prompt by the agent, so there's no recall tool here.
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
