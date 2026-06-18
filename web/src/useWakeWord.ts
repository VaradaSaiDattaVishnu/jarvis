import { useEffect, useRef } from "react";

/**
 * useWakeWord — listen continuously for the spoken word "Jarvis" and fire a
 * callback each time it's heard.
 *
 * How it works: we lean on the browser's built-in Web Speech API
 * (`SpeechRecognition`, prefixed `webkitSpeechRecognition` in Chrome/Safari) for
 * continuous, on-the-fly recognition — no model to ship, no extra dependency.
 *
 * Honest caveat: in Chrome this recognition is CLOUD-backed — the background
 * audio is streamed to the browser vendor's speech service. Truly on-device
 * wake-word would need a WASM model (Porcupine/openWakeWord), which we're
 * deliberately not pulling in (keep-it-minimal). The actual command you speak
 * AFTER waking still goes to Groq Whisper via /transcribe; this hook only
 * detects the trigger word.
 *
 * Lifecycle is driven entirely by `enabled`:
 *   enabled=true  → create + start recognition, and auto-restart whenever the
 *                   browser ends a session (Chrome does this roughly every minute).
 *   enabled=false → stop and tear everything down (releases the mic).
 *
 * @param enabled  whether to be listening right now (wired to the UI toggle)
 * @param onWake   called once per detected "Jarvis" (debounced via a cooldown)
 * @returns        { supported } so the UI can disable the toggle where the API
 *                 is missing (e.g. Firefox)
 */

// ---- Minimal Web Speech API typings ---------------------------------------
// The DOM lib doesn't ship these reliably, so we declare just the slice we use
// (keeps the hook strongly typed instead of leaning on `any`).
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  0: SpeechRecognitionAlternative;
  length: number;
}
interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** Resolve whichever constructor this browser exposes (or null if none). */
function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// One spoken "Jarvis" fires many interim results; ignore repeats for this long
// after a hit so the callback runs exactly once per utterance.
const COOLDOWN_MS = 4000;

export function useWakeWord(enabled: boolean, onWake: () => void): { supported: boolean } {
  const Ctor = getRecognitionCtor();
  const supported = Ctor !== null;

  // Keep the latest onWake in a ref so the recognition effect can depend ONLY
  // on `enabled`. Otherwise a fresh onWake closure each render would tear down
  // and rebuild recognition constantly (and drop the mic between rebuilds).
  const onWakeRef = useRef(onWake);
  useEffect(() => {
    onWakeRef.current = onWake;
  }, [onWake]);

  useEffect(() => {
    if (!enabled || !Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true; // keep listening across natural pauses
    recognition.interimResults = true; // act on partials → snappier trigger
    recognition.lang = "en-US";

    let stopped = false; // set on cleanup so onend can't resurrect it
    let cooldownUntil = 0; // performance.now() timestamp; suppresses repeat hits

    recognition.onresult = (e) => {
      // Concatenate everything heard this session and scan for the wake word.
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      if (!/\bjarvis\b/i.test(transcript)) return;

      const now = performance.now();
      if (now < cooldownUntil) return; // already fired for this utterance
      cooldownUntil = now + COOLDOWN_MS;
      onWakeRef.current();
    };

    recognition.onerror = (e) => {
      // Permission/service denials are fatal → stop trying. Transient errors
      // ("no-speech", "aborted") just end the session; onend restarts it.
      if (e.error === "not-allowed" || e.error === "service-not-allowed") stopped = true;
    };

    recognition.onend = () => {
      // Chrome ends a recognition session every ~minute (and on errors). While
      // still enabled, transparently start a fresh one so listening feels
      // continuous. The `stopped` guard prevents a restart after teardown.
      if (stopped) return;
      try {
        recognition.start();
      } catch {
        /* start() throws if it's somehow already running — safe to ignore */
      }
    };

    try {
      recognition.start();
    } catch {
      /* already started — ignore */
    }

    return () => {
      stopped = true; // prevent onend from restarting after we tear down
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop(); // releases the mic
    };
  }, [enabled, Ctor]);

  return { supported };
}
