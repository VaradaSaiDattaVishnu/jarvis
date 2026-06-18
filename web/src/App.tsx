import { useRef, useState } from "react";
import { sendChat, transcribe } from "./api";

interface Message {
  role: "user" | "assistant";
  text: string;
}

/** Speak text aloud using the browser's built-in speech synthesis (no API/key). */
function speak(text: string): void {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel(); // stop any in-progress utterance
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);

  // One thread id per browser session → the backend keeps our conversation
  // (short-term memory) together across turns.
  const threadId = useRef(crypto.randomUUID()).current;
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  /** Send a message to the agent and speak the reply. */
  async function ask(text: string): Promise<void> {
    const clean = text.trim();
    if (!clean || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: clean }]);
    setBusy(true);
    try {
      const reply = await sendChat(clean, threadId);
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
      speak(reply);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Something went wrong reaching JARVIS." }]);
    } finally {
      setBusy(false);
    }
  }

  /** Start recording from the mic. On stop, transcribe then ask. */
  async function startRecording(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop()); // release the mic
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        setBusy(true);
        try {
          const text = await transcribe(blob);
          if (text.trim()) await ask(text);
        } catch {
          setMessages((m) => [...m, { role: "assistant", text: "I couldn't transcribe that." }]);
        } finally {
          setBusy(false);
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "I couldn't access the microphone." }]);
    }
  }

  function stopRecording(): void {
    recorderRef.current?.stop();
    setRecording(false);
  }

  return (
    <div className="app">
      <h1>JARVIS</h1>

      <div className="messages">
        {messages.length === 0 && <p className="hint">Ask me something — type, or tap the mic.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.text}
          </div>
        ))}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={busy}
        />
        <button type="submit" disabled={busy || input.trim() === ""}>
          Send
        </button>
        <button
          type="button"
          className={recording ? "mic recording" : "mic"}
          onClick={() => (recording ? stopRecording() : void startRecording())}
          disabled={busy && !recording}
          title={recording ? "Stop recording" : "Record"}
        >
          {recording ? "◼" : "🎤"}
        </button>
      </form>
    </div>
  );
}
