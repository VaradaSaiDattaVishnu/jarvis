import { getCurrentTime } from "./time";
import { calculator } from "./calculator";
import { getWeather } from "./weather";
import { convertUnits } from "./units";
import { convertCurrency } from "./currency";
import { search } from "./search";
import { documentSearch } from "./documents";
import { summarizeDocument } from "./summarize";
import { rememberFactTool } from "./memory";

/**
 * The full tool set handed to the agent. Adding a capability is a small, obvious
 * change: create a file in this folder, import it here, add it to the array.
 * The agent automatically gains the new ability — no other file changes.
 */
export const tools = [
  getCurrentTime,
  calculator,
  getWeather,
  convertUnits,
  convertCurrency,
  search,
  documentSearch,
  summarizeDocument,
  rememberFactTool,
];
