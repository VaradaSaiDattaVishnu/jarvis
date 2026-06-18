import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve relative to THIS file → always server/data/jarvis.sqlite, regardless
// of the directory the process started from.
const here = dirname(fileURLToPath(import.meta.url)); // server/src
const DB_PATH = join(here, "..", "data", "jarvis.sqlite");
mkdirSync(dirname(DB_PATH), { recursive: true });

/**
 * The single SQLite connection, shared across features.
 *
 * Promoted from `rag/db.ts` to this top-level module in Phase ⑤ once *memory*
 * also needed persistence: shared infrastructure belongs in a shared place, not
 * inside one feature's folder.
 */
export const db = new Database(DB_PATH);

// Schema home for the whole app: RAG chunks + long-term memory facts.
db.exec(`
  CREATE TABLE IF NOT EXISTS chunks (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    source    TEXT NOT NULL,
    content   TEXT NOT NULL,
    embedding TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
