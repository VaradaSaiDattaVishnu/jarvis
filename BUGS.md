# JARVIS — Known Bugs & Issues

## Critical

### 1. LLM Hallucinations (Groq/Llama)
- **Status**: Open
- **Description**: The AI creates tasks, reminders, and takes actions that were never requested. It "imagines" context that doesn't exist.
- **Root Cause**: Llama 3.3 70B (via Groq) is prone to hallucinating tool calls and fabricating user intent, especially with complex system prompts and many available tools.
- **Impact**: Makes JARVIS unreliable — users can't trust that it will only do what's asked.
- **Recommended Fix**: Switch to Anthropic Claude (claude-sonnet-4-20250514 or claude-haiku-4-5-20251001) as the primary LLM provider. Claude is significantly better at:
  - Following instructions precisely without inventing extra actions
  - Tool use / function calling accuracy
  - Understanding when NOT to act
- **Workaround**: Add Anthropic API key in Integrations and set as primary provider. Groq can remain as a fast fallback for simple queries.
- **Notes**: The system prompt may also need tightening — explicitly instruct the LLM to ONLY perform actions the user explicitly requests, never infer or assume tasks.

### 2. Google OAuth — Invalid Client Error
- **Status**: Fixed (credentials removed, validation added)
- **Description**: Clicking "Sign in with Google" showed "Error 401: invalid_client" because fake credentials were saved before validation was added.
- **Fix Applied**:
  - Removed invalid credentials from `.env`
  - Added real Google OAuth validation (tests against `oauth2.googleapis.com/token`)
  - CalendarService now reloads when credentials are updated
  - Placeholder values (e.g., `your-api-key-here`) are now filtered out

### 3. API Keys — No Validation Before Save
- **Status**: Fixed
- **Description**: Random letters were accepted as valid API keys, showing services as "Connected" when they weren't.
- **Fix Applied**: `validateServiceKey()` now tests each key against the actual service API before saving. Invalid keys are rejected with clear error messages.

---

## Medium

### 4. Services Show "Connected" With Invalid Keys
- **Status**: Fixed
- **Description**: Any value in `.env` (even placeholders) made services appear as "Connected" in the UI.
- **Fix Applied**: `isRealValue()` filter rejects placeholders like `your-xxx-here`. OAuth services (Google, Spotify, Home Assistant) use runtime connection state instead of just checking env vars.

### 5. AI Doesn't Check Actual Integration Status
- **Status**: Open
- **Description**: When user asks "can you access my Google Calendar?", the AI gives a generic response instead of checking `calendar.ready` and reporting actual status.
- **Recommended Fix**: Enhance the system prompt to include real-time integration status, so the LLM knows which services are actually connected. Possibly add a `check_status` tool the AI can call.

### 6. Task-Calendar Sync Not Testable Without Google Auth
- **Status**: Blocked
- **Description**: Task creation auto-syncs to Google Calendar when connected, but this can't be tested until valid Google OAuth credentials are set up.
- **Implementation**: Code is in place — creates `[Task]` events on due date, deletes on completion/removal.

---

## Low

### 7. No "Disconnect" / "Reconfigure" Button for Services
- **Status**: Open
- **Description**: Once a service is configured, there's no way to disconnect or re-enter credentials from the UI. Users would need to manually edit `.env`.
- **Recommended Fix**: Add a "Reconfigure" or "Disconnect" button on connected integration cards.

### 8. No Visual Feedback During OAuth Popup
- **Status**: Open
- **Description**: When the OAuth popup opens, the main page shows "Waiting for authorization..." but doesn't indicate progress clearly. If the popup is blocked, there's no fallback.
- **Recommended Fix**: Add popup-blocked detection and show a manual link as fallback.

### 9. Chat Input — No Error Toast on Send Failure
- **Status**: Open
- **Description**: If the WebSocket is disconnected when the user sends a message, it silently fails.
- **Recommended Fix**: Show a toast notification on send failure with retry option.

---

## Enhancement Requests

### E1. Claude as Primary LLM
- Add proper provider switching in settings (Groq vs Anthropic)
- Claude should be recommended as primary for better accuracy
- Groq/Llama can be fast fallback for simple queries

### E2. System Prompt Improvements
- Add explicit instruction: "Only perform actions the user explicitly requests"
- Include real-time service status in context
- Reduce tool-call hallucination by being more specific about when to use each tool

### E3. Provider Quality Comparison
- Consider A/B testing between Groq and Anthropic
- Log response quality metrics (hallucination rate, user corrections)
