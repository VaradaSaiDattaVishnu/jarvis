import "dotenv/config";

/**
 * Centralised, validated environment configuration.
 *
 * Required vars are checked ONCE, here, at startup — if one is missing the
 * process refuses to boot with a clear message rather than failing cryptically
 * on the first user request. Optional vars degrade gracefully instead.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        "Copy server/.env.example to server/.env and fill it in.",
    );
  }
  return value;
}

/** Like `required`, but returns `undefined` instead of throwing when unset. */
function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

export const env = {
  /** Port to listen on. Hosting platforms inject this; default for local dev. */
  port: Number(process.env.PORT) || 3001,

  /** Claude API key — REQUIRED. Get one at https://console.anthropic.com */
  anthropicApiKey: required("ANTHROPIC_API_KEY"),

  /**
   * Tavily web-search key — OPTIONAL. If unset, the `search` tool degrades
   * gracefully. Free key at https://tavily.com
   */
  tavilyApiKey: optional("TAVILY_API_KEY"),

  /**
   * Groq key — OPTIONAL. Powers speech-to-text (Whisper) at /transcribe. If
   * unset, voice input is disabled but text chat still works. Free key at
   * https://console.groq.com
   */
  groqApiKey: optional("GROQ_API_KEY"),
};
