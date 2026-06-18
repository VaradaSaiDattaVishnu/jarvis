import { tool } from "@langchain/core/tools";
import { z } from "zod";

/** A tool with structured inputs — each schema field is documented for the model. */
export const calculator = tool(
  async ({ a, b, operation }) => {
    switch (operation) {
      case "add":
        return `${a + b}`;
      case "subtract":
        return `${a - b}`;
      case "multiply":
        return `${a * b}`;
      case "divide":
        return b === 0 ? "Error: cannot divide by zero." : `${a / b}`;
      default:
        return "Error: unknown operation.";
    }
  },
  {
    name: "calculator",
    description: "Perform a basic arithmetic operation on two numbers.",
    schema: z.object({
      a: z.number().describe("The first operand"),
      b: z.number().describe("The second operand"),
      operation: z
        .enum(["add", "subtract", "multiply", "divide"])
        .describe("The arithmetic operation to perform"),
    }),
  },
);
