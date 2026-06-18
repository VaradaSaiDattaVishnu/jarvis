import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * A REAL external-API tool — no key required (Frankfurter, backed by ECB rates).
 */
export const convertCurrency = tool(
  async ({ amount, from, to }) => {
    const base = from.toUpperCase();
    const target = to.toUpperCase();
    const url = `https://api.frankfurter.app/latest?amount=${amount}&from=${base}&to=${target}`;

    const res = await fetch(url);
    if (!res.ok) return `Could not convert ${base} to ${target} (HTTP ${res.status}).`;
    // Node's fetch types json() as `unknown`, so assert the shape we rely on.
    const data = (await res.json()) as { rates?: Record<string, number>; date: string };

    const converted = data.rates?.[target];
    if (converted === undefined) {
      return `I don't have an exchange rate for ${base} → ${target}.`;
    }
    return `${amount} ${base} = ${converted} ${target} (rate as of ${data.date}).`;
  },
  {
    name: "convert_currency",
    description:
      "Convert an amount of money from one currency to another using up-to-date exchange rates.",
    schema: z.object({
      amount: z.number().describe("The amount to convert"),
      from: z.string().describe("3-letter source currency code, e.g. USD"),
      to: z.string().describe("3-letter target currency code, e.g. EUR"),
    }),
  },
);
