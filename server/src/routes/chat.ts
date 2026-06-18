import { Router } from "express";
import { runAgent } from "../agent/agent";

export const chatRouter = Router();

/**
 * POST /chat
 *   body: { "message": "...", "threadId"?: "..." }   ->   { "reply": "..." }
 *
 * `threadId` is optional and selects the conversation (for short-term memory).
 * Omit it and everything shares one "default" thread. A real frontend would send
 * a stable per-conversation id.
 *
 * The try/catch matters: Express 4 does NOT catch errors thrown from async
 * handlers, so without it a failed turn would crash the request instead of
 * returning a clean 500.
 */
chatRouter.post("/", async (req, res) => {
  const { message, threadId } = req.body ?? {};

  if (typeof message !== "string" || message.trim() === "") {
    res
      .status(400)
      .json({ error: "Body must include a non-empty 'message' string." });
    return;
  }

  const thread =
    typeof threadId === "string" && threadId.trim() !== "" ? threadId : "default";

  try {
    const reply = await runAgent(message, thread);
    res.json({ reply });
  } catch (err) {
    console.error("Agent error:", err);
    res.status(500).json({ error: "The assistant failed to respond." });
  }
});
