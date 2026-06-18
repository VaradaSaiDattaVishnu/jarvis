import { tool } from "@langchain/core/tools";
import { z } from "zod";

/** A tool with no inputs — returns the current time. */
export const getCurrentTime = tool(
  async () => new Date().toISOString(),
  {
    name: "get_current_time",
    description:
      "Get the current date and time as an ISO-8601 string. Use this whenever the user asks what time or date it is.",
    schema: z.object({}),
  },
);
