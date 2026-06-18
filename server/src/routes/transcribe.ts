import { Router, raw } from "express";
import { transcribeAudio } from "../voice/transcribe";
import { env } from "../config/env";

export const transcribeRouter = Router();

/**
 * POST /transcribe   body: raw audio bytes (e.g. audio/webm)   ->   { "text": "..." }
 *
 * The browser records a short clip and POSTs the raw blob here; we hand it to
 * Groq Whisper and return the transcript. `raw({ type: () => true })` reads the
 * body as a Buffer for ANY content-type (this route only) — the global JSON
 * parser leaves audio bodies untouched.
 *
 * If GROQ_API_KEY isn't set we return 503 (not 500) so the frontend can tell
 * "voice is off" apart from "voice broke".
 */
transcribeRouter.post("/", raw({ type: () => true, limit: "25mb" }), async (req, res) => {
  if (!env.groqApiKey) {
    res.status(503).json({ error: "Voice transcription is not configured (set GROQ_API_KEY)." });
    return;
  }

  const audio = req.body as Buffer;
  if (!Buffer.isBuffer(audio) || audio.length === 0) {
    res.status(400).json({ error: "Request body must be non-empty audio bytes." });
    return;
  }

  try {
    const text = await transcribeAudio(audio, req.headers["content-type"] ?? "audio/webm");
    res.json({ text });
  } catch (err) {
    console.error("Transcription error:", err);
    res.status(500).json({ error: "Transcription failed." });
  }
});
