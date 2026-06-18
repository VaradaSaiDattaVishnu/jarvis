import { db } from "../db";

/**
 * Long-term memory: durable facts about the user, stored in SQLite so they
 * survive restarts and persist across every conversation. Deliberately simple —
 * at personal-assistant scale you have a handful of facts, so `recallFacts`
 * returns them all and lets the model pick what's relevant. (If this grew to
 * thousands of facts, you'd embed them and reuse the RAG cosine search.)
 */

/** Save one fact. */
export function rememberFact(content: string): void {
  db.prepare("INSERT INTO memories (content) VALUES (?)").run(content);
}

/**
 * Return every saved fact, newest first. Called every turn by the agent's dynamic
 * system prompt, which injects these into the prompt so recall is always-on.
 */
export function recallFacts(): string[] {
  const rows = db
    .prepare("SELECT content FROM memories ORDER BY id DESC")
    .all() as Array<{ content: string }>;
  return rows.map((row) => row.content);
}
