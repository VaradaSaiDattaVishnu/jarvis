import { env } from "../config/env";

/**
 * Speech-to-text via Groq's Whisper endpoint (OpenAI-compatible API).
 *
 * We forward the raw audio bytes as a multipart upload. Node 18+ provides global
 * `FormData`, `Blob`, and `fetch`, so no SDK or extra dependency is needed — the
 * request is fully visible here.
 */
export async function transcribeAudio(audio: Buffer, mimeType: string): Promise<string> {
  if (!env.groqApiKey) {
    throw new Error("Voice transcription is not configured (GROQ_API_KEY is missing).");
  }

  const form = new FormData();
  form.append("file", new Blob([audio], { type: mimeType || "audio/webm" }), "audio.webm");
  form.append("model", "whisper-large-v3-turbo"); // fast, accurate Whisper on Groq

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.groqApiKey}` },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Groq transcription failed (HTTP ${res.status}): ${detail}`);
  }

  const data = (await res.json()) as { text: string };
  return data.text;
}
