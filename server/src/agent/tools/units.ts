import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Linear units expressed as a factor to a base unit (metres / grams).
const LENGTH: Record<string, number> = {
  m: 1, km: 1000, cm: 0.01, mm: 0.001,
  mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254,
};
const MASS: Record<string, number> = {
  g: 1, kg: 1000, mg: 0.001, lb: 453.59237, oz: 28.349523,
};

// Temperature is offset-based, so it can't use simple factors — convert via °C.
function toCelsius(value: number, unit: string): number | null {
  switch (unit) {
    case "c": case "celsius": return value;
    case "f": case "fahrenheit": return (value - 32) * (5 / 9);
    case "k": case "kelvin": return value - 273.15;
    default: return null;
  }
}
function fromCelsius(celsius: number, unit: string): number | null {
  switch (unit) {
    case "c": case "celsius": return celsius;
    case "f": case "fahrenheit": return celsius * (9 / 5) + 32;
    case "k": case "kelvin": return celsius + 273.15;
    default: return null;
  }
}

function convert(value: number, from: string, to: string): number | null {
  // Temperature first (special-cased).
  const celsius = toCelsius(value, from);
  if (celsius !== null) return fromCelsius(celsius, to);

  // Linear units: only convert within the same category.
  if (Object.hasOwn(LENGTH, from) && Object.hasOwn(LENGTH, to)) {
    return (value * LENGTH[from]) / LENGTH[to];
  }
  if (Object.hasOwn(MASS, from) && Object.hasOwn(MASS, to)) {
    return (value * MASS[from]) / MASS[to];
  }
  return null; // unknown units or mismatched categories
}

/** A pure-local tool — no network, fully deterministic. */
export const convertUnits = tool(
  async ({ value, from, to }) => {
    const result = convert(value, from.toLowerCase(), to.toLowerCase());
    if (result === null) {
      return `I can't convert from "${from}" to "${to}". Supported: length (m, km, cm, mm, mi, yd, ft, in), mass (g, kg, mg, lb, oz), temperature (c, f, k).`;
    }
    // Round to 4 decimals for a clean spoken answer.
    return `${value} ${from} = ${Math.round(result * 10000) / 10000} ${to}`;
  },
  {
    name: "convert_units",
    description: "Convert a value between units of length, mass, or temperature.",
    schema: z.object({
      value: z.number().describe("The numeric value to convert"),
      from: z.string().describe("Source unit, e.g. km, lb, c"),
      to: z.string().describe("Target unit, e.g. mi, kg, f"),
    }),
  },
);
