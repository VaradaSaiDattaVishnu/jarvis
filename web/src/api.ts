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

/**
 * Ingest a document into the agent's knowledge base (RAG). The backend takes the
 * filename in the query string and the RAW FILE BYTES as the body (NOT multipart)
 * — so we pass the File straight through as `body` and deliberately set NO
 * Content-Type, letting the browser send the file's own type (the backend accepts
 * any). Returns the chunk count so the UI can confirm what was indexed.
 */
export async function uploadDocument(file: File): Promise<{ source: string; chunks: number }> {
  const res = await fetch(`/documents?filename=${encodeURIComponent(file.name)}`, {
    method: "POST",
    body: file,
  });
  if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status})`);
  return (await res.json()) as { source: string; chunks: number };
}

/** List the documents already ingested into the knowledge base (for the header chips). */
export async function listDocuments(): Promise<{ source: string; chunks: number }[]> {
  const res = await fetch("/documents");
  if (!res.ok) throw new Error(`Listing documents failed (HTTP ${res.status})`);
  const data = (await res.json()) as { documents: { source: string; chunks: number }[] };
  return data.documents;
}

/**
 * One-shot reachability check for the backend. Returns true only if `/health`
 * responds with a 2xx; any network error (server down, offline) resolves to
 * false instead of throwing, so callers can treat it as a plain boolean.
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch("/health");
    return res.ok;
  } catch {
    return false;
  }
}
