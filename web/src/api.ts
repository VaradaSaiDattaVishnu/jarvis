// Thin client for the backend. Relative URLs work in dev (Vite proxy forwards
// them to :3001) and in production (Express serves this app on the same origin).

export async function sendChat(message: string, threadId: string): Promise<string> {
  const res = await fetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, threadId }),
  });
  if (!res.ok) throw new Error(`Chat failed (HTTP ${res.status})`);
  const data = (await res.json()) as { reply: string };
  return data.reply;
}

export async function transcribe(audio: Blob): Promise<string> {
  const res = await fetch("/transcribe", {
    method: "POST",
    headers: { "Content-Type": audio.type || "audio/webm" },
    body: audio,
  });
  if (!res.ok) throw new Error(`Transcription failed (HTTP ${res.status})`);
  const data = (await res.json()) as { text: string };
  return data.text;
}
