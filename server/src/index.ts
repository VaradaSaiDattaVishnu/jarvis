import { env } from "./config/env";
import { buildApp } from "./app";

// Importing `env` first validates configuration before we do anything else —
// if a required key is missing, we crash here with a clear message rather than
// after the server is already accepting (and failing) requests.
const app = buildApp();

app.listen(env.port, () => {
  console.log(`🤖 JARVIS server listening on http://localhost:${env.port}`);
});
