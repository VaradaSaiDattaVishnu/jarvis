import { useEffect, useReducer, useRef, useState } from "react";
import { sendChat, transcribe, checkHealth, uploadDocument, listDocuments } from "./api";
import { useWakeWord } from "./useWakeWord";

// A few one-tap starter prompts for the empty state. Kept tiny and generic so
// they showcase the assistant without dictating a specific demo flow.
const EXAMPLE_PROMPTS = ["What can you do?", "What's the weather in Tokyo?", "Tell me a fun fact"];

// ---- Voice-activity-detection (VAD) tuning --------------------------------
// RMS loudness (0..1) at or below this counts as "silence". Speech typically
// sits around 0.05–0.3; a quiet room's background hum stays well under 0.01.
const SILENCE_RMS = 0.015;
// Auto-stop this long after speech ends. ~1.2s feels snappy yet still lets you
// pause briefly mid-sentence without getting cut off.
const SILENCE_HANGOVER_MS = 1200;
// Safety net: never record longer than this, even if VAD never sees silence
// (e.g. a noisy room that holds the energy gate open).
const MAX_UTTERANCE_MS = 20000;
// Number of equalizer bars in the "Listening…" indicator.
const BAR_COUNT = 5;

interface Message {
  role: "user" | "assistant";
  text: string;
}

// ---- Phase state machine ---------------------------------------------------
// A single source of truth for "what is JARVIS doing right now". We use a
// reducer (not scattered booleans) so every transition is explicit and named:
// the UI can never end up in an impossible combination of flags, and there's
// exactly one place to read/audit how phases change.
type Phase = "idle" | "listening" | "transcribing" | "thinking" | "ingesting";

// Named actions = the only legal ways to move between phases.
type Action =
  | { type: "RECORD" } //  mic recording started    → listening
  | { type: "STOP" } //    recording stopped        → transcribing
  | { type: "ASK" } //     sending to the agent      → thinking
  | { type: "INGEST" } //  uploading document(s)    → ingesting
  | { type: "DONE" }; //   reply / error / empty    → idle

function reduce(_phase: Phase, action: Action): Phase {
  switch (action.type) {
    case "RECORD":
      return "listening"; // user tapped mic; we're capturing audio
    case "STOP":
      return "transcribing"; // recording ended; audio is being transcribed
    case "ASK":
      return "thinking"; // text sent to the agent; awaiting the reply
    case "INGEST":
      return "ingesting"; // file(s) being uploaded + indexed into the knowledge base
    case "DONE":
      return "idle"; // settled — works for success AND every error path
  }
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
  const [phase, dispatch] = useReducer(reduce, "idle");

  // Backend reachability shown as a header dot. Three-state on purpose:
  //   null  → haven't heard back yet (grey "Connecting…")
  //   true  → last interaction reached the server (green "Online")
  //   false → last interaction failed (red "Offline")
  // EVENT-DRIVEN, not polled: we ping `/health` exactly once on mount, then let
  // the outcome of real chat/transcribe calls keep this honest (see ask/record).
  const [online, setOnline] = useState<boolean | null>(null);

  // Documents already ingested into the knowledge base. Loaded once on mount and
  // refreshed after every upload; rendered as small muted chips under the header.
  const [docs, setDocs] = useState<{ source: string; chunks: number }[]>([]);

  // Drag-and-drop highlight. A genuinely transient *view* flag (true only while a
  // file is hovering over the drop zone) — NOT a phase, so a plain useState fits.
  const [dragging, setDragging] = useState(false);

  // Equalizer-bar heights (0..1), refreshed every animation frame while
  // listening. State (not a ref) so the bars re-render; the rAF loop is the
  // only writer. See startRecording/tick for how the analyser drives these.
  const [bars, setBars] = useState<number[]>(new Array(BAR_COUNT).fill(0));

  // Derived UI state — never stored separately, so it can't drift from `phase`.
  // `busy` is true only while async work that should lock the composer is in
  // flight; `listening` keeps the mic clickable so the user can stop recording.
  const busy = phase === "transcribing" || phase === "thinking" || phase === "ingesting";
  const recording = phase === "listening";

  // Status label also derives from `phase` (single source of truth). Ingesting
  // reuses the same strip — no second status bar to keep in sync.
  const status =
    phase === "listening"
      ? "Listening…"
      : phase === "transcribing"
        ? "Transcribing…"
        : phase === "ingesting"
          ? "Ingesting…"
          : null;

  // The thread id keys our conversation on the backend. Persisting it in
  // localStorage is what lets short-term memory survive a reload: same id after
  // refresh → same conversation. It's React state (not a ref) so "New chat" can
  // swap in a fresh id and re-render. Lazy initializer runs once, on mount.
  const [threadId, setThreadId] = useState<string>(() => {
    const saved = localStorage.getItem("jarvis.threadId");
    if (saved) return saved;
    const fresh = crypto.randomUUID();
    localStorage.setItem("jarvis.threadId", fresh);
    return fresh;
  });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Hidden <input type="file"> we trigger from the visible 📎 button.
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Web Audio + VAD resources. Refs because they outlive renders and must be
  // torn down deterministically (release the mic, close the audio graph).
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  // Analyser scratch buffers — allocated once per recording, reused each frame
  // (avoids ~60 array allocations/second).
  // Annotated <ArrayBuffer> (not the default ArrayBufferLike) so they satisfy
  // AnalyserNode's getByte*Data signatures under TS 5.7's generic typed arrays.
  const timeBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const freqBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  // VAD bookkeeping: written ~60×/s by the rAF loop, so refs (never state).
  const speechStartedRef = useRef(false); // has the user spoken yet this turn?
  const silenceSinceRef = useRef<number | null>(null); // ms timestamp silence began
  const recStartRef = useRef(0); // ms timestamp recording began

  // Auto-scroll: smoothly bring the bottom sentinel into view whenever the
  // message list grows OR the phase changes — the latter so the appearance of
  // the "thinking" bubble (which isn't in `messages`) also scrolls into view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase]);

  // One-shot connectivity probe on mount (no setInterval — see `online` above).
  // After this initial reading, ask()/startRecording() keep `online` current
  // from the success/catch of the actual requests the user makes.
  useEffect(() => {
    void checkHealth().then(setOnline);
  }, []);

  // Load the already-ingested documents once on mount so the header chips reflect
  // server state on load. Swallow errors → empty list (a failed fetch shouldn't
  // block the app; the connectivity dot already surfaces "Offline").
  useEffect(() => {
    listDocuments().then(setDocs).catch(() => {});
  }, []);

  // Refocus the text input once work finishes. Teaching point: the input is
  // `disabled={busy}` while sending, and a *disabled* element can't hold focus —
  // so we wait for `busy` to flip back to false (phase → idle) and focus then,
  // letting the user keep typing without reaching for the mouse.
  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy]);

  // ---- Esc to stop speaking + "Jarvis" wake word -------------------------
  // Esc cancels whatever JARVIS is currently saying (barge-in). It deliberately
  // touches ONLY speech — an in-flight request or recording is left alone.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") window.speechSynthesis?.cancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Opt-in voice wake word (OFF by default; the header toggle flips `wakeWord`).
  // When a spoken "Jarvis" is detected we BOTH (3) cut off any reply being spoken
  // AND (1) start listening for the next command. startRecording() already no-ops
  // unless phase === "idle", so saying "Jarvis" mid-turn only does the interrupt.
  const [wakeWord, setWakeWord] = useState(false);
  function handleWake(): void {
    window.speechSynthesis?.cancel(); // (3) interrupt the current spoken reply
    void startRecording(); // (1) capture the next command (guards on phase)
  }
  const { supported: wakeSupported } = useWakeWord(wakeWord, handleWake);

  // Release the mic and audio graph if we unmount mid-recording.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void audioCtxRef.current?.close();
    };
  }, []);

  /** Start a fresh conversation: new thread id, empty transcript, silence. */
  function newChat(): void {
    const fresh = crypto.randomUUID();
    localStorage.setItem("jarvis.threadId", fresh); // persist so it survives the next reload too
    setThreadId(fresh); // future sends go to a brand-new backend conversation
    setMessages([]); // clear the on-screen history
    window.speechSynthesis?.cancel(); // stop any reply still being spoken aloud
  }

  /** Send a message to the agent and speak the reply. */
  async function ask(text: string): Promise<void> {
    const clean = text.trim();
    if (!clean || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: clean }]);
    dispatch({ type: "ASK" }); // → thinking (shows the thinking bubble)
    try {
      const reply = await sendChat(clean, threadId);
      setOnline(true); // a real round-trip succeeded → we're online
      setMessages((m) => [...m, { role: "assistant", text: reply }]);
      speak(reply);
    } catch {
      setOnline(false); // request failed → reflect offline in the header dot
      setMessages((m) => [...m, { role: "assistant", text: "Something went wrong reaching JARVIS." }]);
    } finally {
      dispatch({ type: "DONE" }); // → idle, even on error (never stuck busy)
    }
  }

  /**
   * Ingest one or more documents into the knowledge base. Accepts an array so the
   * file picker (multiple) and drag-drop share one path. We upload sequentially so
   * each "Added …" confirmation lands in order, and report each result as an
   * assistant bubble. NB: these are UI notices, NOT agent replies, so we never
   * speak() them.
   */
  async function uploadFiles(files: File[]): Promise<void> {
    // Only .txt/.md are accepted by the backend; filter client-side so an
    // unsupported pick fails fast with a friendly note instead of a 400.
    const valid = files.filter((f) => /\.(txt|md)$/i.test(f.name));
    if (valid.length === 0) {
      setMessages((m) => [...m, { role: "assistant", text: "I can only ingest .txt or .md files." }]);
      return; // nothing to do — leave the phase untouched
    }

    dispatch({ type: "INGEST" }); // → ingesting (locks composer, shows the strip)
    try {
      for (const file of valid) {
        const { source, chunks } = await uploadDocument(file);
        setMessages((m) => [
          ...m,
          { role: "assistant", text: `Added ${source} — ${chunks} chunk${chunks === 1 ? "" : "s"}` },
        ]);
        setOnline(true); // a real round-trip succeeded → we're online
      }
    } catch {
      setOnline(false); // upload failed → reflect offline in the header dot
      setMessages((m) => [...m, { role: "assistant", text: "I couldn't ingest that document." }]);
    } finally {
      dispatch({ type: "DONE" }); // → idle, even on error (never stuck busy)
      listDocuments().then(setDocs).catch(() => {}); // refresh the header chips
    }
  }

  /**
   * Read one frame from the analyser.
   * Returns RMS loudness (drives VAD) and per-bar band levels (drives the UI).
   */
  function sampleAudio(): { rms: number; bands: number[] } {
    const analyser = analyserRef.current!;
    const timeData = timeBufRef.current!;
    const freqData = freqBufRef.current!;
    analyser.getByteTimeDomainData(timeData); // raw waveform (0..255, centred at 128)
    analyser.getByteFrequencyData(freqData); // spectrum magnitudes (0..255)

    // RMS of the waveform → perceived loudness (0..1).
    let sumSq = 0;
    for (let i = 0; i < timeData.length; i++) {
      const v = (timeData[i] - 128) / 128; // byte → -1..1
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / timeData.length);

    // Split the lower half of the spectrum (where the human voice lives) into
    // BAR_COUNT bands and average each → one height per equalizer bar.
    const usableBins = Math.floor(freqData.length / 2);
    const perBand = Math.floor(usableBins / BAR_COUNT);
    const bands = new Array(BAR_COUNT).fill(0).map((_, b) => {
      let sum = 0;
      for (let i = 0; i < perBand; i++) sum += freqData[b * perBand + i];
      return sum / perBand / 255; // average magnitude → 0..1
    });

    return { rms, bands };
  }

  /** rAF loop: animate the bars and auto-stop after a silent gap. */
  function tick(): void {
    if (!analyserRef.current) return;
    const { rms, bands } = sampleAudio();
    setBars(bands);

    const now = performance.now();
    if (rms > SILENCE_RMS) {
      speechStartedRef.current = true; // we've now heard speech
      silenceSinceRef.current = null; // any sound resets the silence timer
    } else if (speechStartedRef.current && silenceSinceRef.current === null) {
      silenceSinceRef.current = now; // first silent frame after speaking
    }

    // Auto-stop once silent long enough after speech, or at the safety cap.
    const silentLongEnough =
      silenceSinceRef.current !== null && now - silenceSinceRef.current >= SILENCE_HANGOVER_MS;
    const tooLong = now - recStartRef.current >= MAX_UTTERANCE_MS;
    if (silentLongEnough || tooLong) {
      stopRecording(); // flushes the recorder → onstop → transcribe
      return; // stop scheduling frames
    }

    rafRef.current = requestAnimationFrame(tick);
  }

  /**
   * Start listening. We open the mic ONCE and fan the single stream out to two
   * consumers: MediaRecorder (the bytes we POST to /transcribe) and a Web Audio
   * AnalyserNode (loudness + spectrum for VAD and the bars). On stop we release
   * the mic, transcribe, then ask.
   */
  async function startRecording(): Promise<void> {
    if (phase !== "idle") return; // ignore taps while transcribing/thinking
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // --- MediaRecorder: the actual audio we POST to /transcribe ----------
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        // Release hardware + audio graph now that the bytes are captured.
        stream.getTracks().forEach((t) => t.stop()); // release the mic
        void audioCtxRef.current?.close();
        audioCtxRef.current = null;
        analyserRef.current = null;
        streamRef.current = null;

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        if (blob.size === 0) {
          dispatch({ type: "DONE" }); // nothing captured (instant stop) → idle
          return;
        }
        dispatch({ type: "STOP" }); // → transcribing (reflect the POST immediately)
        try {
          const text = await transcribe(blob);
          setOnline(true); // transcription reached the server → online
          if (text.trim()) {
            await ask(text); // ask() dispatches ASK → thinking, then DONE
          } else {
            dispatch({ type: "DONE" }); // nothing transcribed → back to idle
          }
        } catch {
          setOnline(false); // transcribe request failed → header dot goes red
          setMessages((m) => [...m, { role: "assistant", text: "I couldn't transcribe that." }]);
          dispatch({ type: "DONE" }); // error → back to idle
        }
      };
      recorderRef.current = recorder;

      // --- Web Audio graph: taps the SAME stream only to measure loudness --
      // mic → source → analyser. We deliberately DON'T connect to destination,
      // so you never hear your own voice echoed back.
      const audioCtx = new AudioContext();
      if (audioCtx.state === "suspended") await audioCtx.resume(); // gesture-gated browsers
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048; // → 2048 time samples + 1024 frequency bins
      analyser.smoothingTimeConstant = 0.7; // damp jittery bars frame-to-frame
      source.connect(analyser);
      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
      timeBufRef.current = new Uint8Array(analyser.fftSize);
      freqBufRef.current = new Uint8Array(analyser.frequencyBinCount);

      // Reset VAD state, then start capture + the analysis loop.
      speechStartedRef.current = false;
      silenceSinceRef.current = null;
      recStartRef.current = performance.now();
      recorder.start();
      dispatch({ type: "RECORD" }); // → listening
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "I couldn't access the microphone." }]);
      dispatch({ type: "DONE" }); // mic-permission error → stay idle
    }
  }

  /** Stop listening — called automatically by VAD or manually via the button. */
  function stopRecording(): void {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current); // halt the meter immediately
      rafRef.current = null;
    }
    setBars(new Array(BAR_COUNT).fill(0)); // collapse the bars
    // recorder.stop() flushes buffered audio and fires onstop (→ transcribe).
    recorderRef.current?.stop();
  }

  // Human-readable label for the connectivity dot, derived from the three-state
  // `online` value. Used for both the tooltip/aria-label and the tiny text.
  const onlineLabel = online === null ? "Connecting…" : online ? "Online" : "Offline";

  return (
    <div className="app">
      <div className="header">
        <div className="brand">
          <h1>JARVIS</h1>
          {/* Connectivity dot: grey (null) / green (true) / red (false), driven
              by real request outcomes. role="status" so screen readers announce
              changes; the label doubles as hover tooltip and visible text. */}
          <span
            className={`dot ${online === null ? "connecting" : online ? "online" : "offline"}`}
            role="status"
            aria-label={onlineLabel}
            title={onlineLabel}
          />
          <span className="online-label">{onlineLabel}</span>
        </div>
        {/* Right-side header controls: wake-word toggle + New chat. */}
        <div className="header-actions">
          {/* Wake-word toggle. Disabled where the Web Speech API is missing
              (e.g. Firefox); aria-pressed reflects on/off for screen readers. */}
          <button
            type="button"
            className={`wake-toggle${wakeWord ? " on" : ""}`}
            onClick={() => setWakeWord((v) => !v)}
            disabled={!wakeSupported}
            aria-pressed={wakeWord}
            title={
              wakeSupported
                ? 'Listen for the wake word "Jarvis"'
                : "Wake word needs Chrome, Edge, or Safari"
            }
          >
            🎙️ Wake word
          </button>
          {/* type="button" so it can never accidentally submit the composer form;
              always enabled so the user can bail out of a slow/looping reply. */}
          <button type="button" className="new-chat" onClick={newChat}>
            New chat
          </button>
        </div>
      </div>

      {/* Ingested-document chips: a small, muted row under the header. Rendered
          only when there's something to show, so it adds no visual weight to a
          fresh session. Each chip names the source and its chunk count. */}
      {docs.length > 0 && (
        <div className="docs" aria-label="Ingested documents">
          {docs.map((d) => (
            <span key={d.source} className="doc" title={`${d.source} — ${d.chunks} chunks`}>
              📄 {d.source} <span className="doc-chunks">{d.chunks}</span>
            </span>
          ))}
        </div>
      )}

      {/* The chat area doubles as a drop zone for documents. We preventDefault on
          dragover/drop (the browser's default is to navigate to/open the file),
          toggle a transient `dragging` highlight, and hand any dropped files to
          uploadFiles. Drops are ignored while busy so an in-flight ingest/turn
          isn't interrupted. */}
      <div
        className={dragging ? "messages dragging" : "messages"}
        onDragOver={(e) => {
          e.preventDefault(); // allow the drop (default would reject it)
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (busy) return; // don't interrupt an in-flight ingest/turn
          void uploadFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {messages.length === 0 && (
          // Centered welcome shown only on an empty transcript. The example
          // chips just prefill the input (then focus it) — they don't auto-send,
          // so the user stays in control and can tweak before hitting Send.
          <div className="empty">
            <p className="empty-title">Hi, I'm JARVIS.</p>
            <p className="empty-sub">Type a message below, or tap the mic to talk.</p>
            <div className="examples">
              {EXAMPLE_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="example"
                  onClick={() => {
                    setInput(p);
                    inputRef.current?.focus();
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.text}
          </div>
        ))}

        {/* Live "thinking" bubble: rendered conditionally (NOT pushed into the
            messages array) so it vanishes the instant the real reply arrives. */}
        {phase === "thinking" && (
          <div className="msg assistant thinking" aria-label="JARVIS is thinking">
            <span className="dots">
              <span></span>
              <span></span>
              <span></span>
            </span>
          </div>
        )}

        {/* Bottom sentinel that the auto-scroll effect scrolls into view. */}
        <div ref={endRef} />
      </div>

      {/* Subtle status strip above the composer for the non-bubble phases.
          While listening it also shows live equalizer bars driven by the mic. */}
      {status && (
        <div className={`status ${phase}`}>
          <span className="status-label">{status}</span>
          {recording && (
            <div className="bars" aria-hidden="true">
              {bars.map((h, i) => (
                // scaleY animates on the GPU; the 0.12 floor keeps bars visible.
                <span key={i} className="bar" style={{ transform: `scaleY(${0.12 + h * 0.88})` }} />
              ))}
            </div>
          )}
        </div>
      )}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={busy}
        />
        <button type="submit" disabled={busy || input.trim() === ""}>
          {/* Pure-CSS spinner while busy; falls back to the label otherwise. */}
          {busy ? <span className="spinner" aria-label="Working" /> : "Send"}
        </button>
        {/* Hidden file input the 📎 button drives. `multiple` so several docs can
            be queued at once; `accept` hints the picker toward .txt/.md (we also
            filter in uploadFiles, since accept is only advisory). */}
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            void uploadFiles(Array.from(e.target.files ?? []));
            e.target.value = ""; // reset so picking the SAME file again still fires onChange
          }}
        />
        {/* Attach button: a secondary control (styled like .mic) that opens the
            hidden picker. Disabled while busy so we don't start an upload mid-turn. */}
        <button
          type="button"
          className="mic"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="Upload document"
        >
          📎
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
