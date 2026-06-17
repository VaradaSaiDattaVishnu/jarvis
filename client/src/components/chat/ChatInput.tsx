import { useState, useRef, useEffect } from 'react';
import { Send, Mic, MicOff } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import { ws } from '../../api/websocket';

export default function ChatInput() {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listeningRef = useRef(false);  // does the user WANT the mic on?
  const runningRef = useRef(false);     // is recognition actively running right now?

  const isStreaming = useChatStore((s) => s.isStreaming);
  const isSpeaking = useChatStore((s) => s.isSpeaking);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const setCoreState = useChatStore((s) => s.setCoreState);
  const voiceMode = useChatStore((s) => s.voiceMode);
  const setVoiceMode = useChatStore((s) => s.setVoiceMode);

  const setListen = (val: boolean) => {
    listeningRef.current = val;
    setListening(val);
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendMessage(trimmed);
    ws.send({ type: 'message', text: trimmed });
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      ws.send({ type: 'interrupt' });
    }
  };

  // Start the recognizer only when it isn't already running. The Web Speech API
  // throws InvalidStateError on a double .start(), and races with onend if you
  // stop/start too quickly — runningRef guards both.
  const safeStart = () => {
    const rec = recognitionRef.current;
    if (!rec || runningRef.current) return;
    try {
      rec.start();
      runningRef.current = true;
    } catch {
      /* already started — ignore */
    }
  };

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('SpeechRecognition not supported in this browser');
      return;
    }
    if (recognitionRef.current) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      // Separate finalized text from in-progress (interim) text.
      let finalText = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }

      const mode = useChatStore.getState().voiceMode;

      // Cold (wake-word) mode: do nothing until we hear "JARVIS".
      if (mode === 'cold') {
        if (/\bjarvis\b/i.test(finalText + ' ' + interim)) {
          setVoiceMode('conversation');
          setCoreState('passive');
        }
        return;
      }

      // Conversation mode: pulse the orb on interim speech, send on a final.
      if (interim.trim()) {
        setCoreState('active');
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => setCoreState('passive'), 1500);
      }
      const finalized = finalText.trim();
      // Guard against echoing JARVIS's own voice: if it's mid-utterance, drop it.
      if (finalized && !useChatStore.getState().isSpeaking) {
        sendMessage(finalized);
        ws.send({ type: 'message', text: finalized });
      }
    };

    recognition.onerror = (e: any) => {
      // 'no-speech' / 'aborted' are routine in continuous mode — keep going and
      // let onend restart us. Only a denied mic permission should stop listening.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setListen(false);
      }
    };

    recognition.onend = () => {
      runningRef.current = false;
      // Continuous recognition ends itself periodically; restart if the user
      // still wants the mic on and JARVIS isn't speaking.
      if (listeningRef.current && !useChatStore.getState().isSpeaking) {
        safeStart();
      }
    };

    recognitionRef.current = recognition;
    setListen(true);
    setCoreState(voiceMode === 'cold' ? 'idle' : 'passive');
    safeStart();
  };

  const stopListening = () => {
    setListen(false);
    setVoiceMode('cold');
    setCoreState('idle');
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    runningRef.current = false;
    if (rec) { try { rec.stop(); } catch { /* ok */ } }
  };

  // ─── Pause mic while JARVIS speaks, resume cleanly after ─────────────────
  // We suspend recognition during TTS playback so the mic never transcribes
  // JARVIS's own voice, then resume shortly after it finishes (a small delay
  // avoids catching the audio tail). This is the single place that drives the
  // speaking↔listening handoff — onresult no longer has to fight it.
  useEffect(() => {
    if (!listeningRef.current || !recognitionRef.current) return;
    if (isSpeaking) {
      try { recognitionRef.current.stop(); } catch { /* ok */ }
      return;
    }
    const t = setTimeout(() => {
      if (listeningRef.current && useChatStore.getState().voiceMode !== 'cold') safeStart();
      else if (listeningRef.current) safeStart(); // cold mode still listens for the wake word
    }, 250);
    return () => clearTimeout(t);
  }, [isSpeaking]);

  useEffect(() => {
    return () => {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      runningRef.current = false;
      if (rec) { try { rec.stop(); } catch { /* ok */ } }
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, []);

  return (
    <div className="px-3 md:px-5 pb-4 pt-3 z-10 border-t border-jarvis-border glass">
      <div className="flex items-center gap-2 border border-jarvis-border rounded-sm px-1 pl-4 py-1 bg-[rgba(0,20,40,0.3)] focus-within:border-jarvis-cyan-dim transition-colors">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isSpeaking ? 'JARVIS is speaking...'
            : listening ? (voiceMode === 'cold' ? 'Say "JARVIS" to speak...' : 'Listening...')
            : 'Type a message or click mic...'
          }
          className="flex-1 bg-transparent border-none outline-none text-jarvis-fg font-sans text-[0.85rem] font-light placeholder:text-jarvis-fg-dim placeholder:font-mono placeholder:text-[0.7rem]"
          disabled={isStreaming}
          autoComplete="off"
        />

        {/* Mic button — amber while paused during TTS, cyan while active */}
        <button
          onClick={() => listening ? stopListening() : startListening()}
          className={`w-9 h-9 rounded-sm border flex items-center justify-center cursor-pointer transition-all flex-shrink-0 ${
            listening
              ? isSpeaking
                ? 'border-jarvis-amber bg-jarvis-amber/10 text-jarvis-amber'
                : 'border-jarvis-cyan bg-jarvis-cyan-glow text-jarvis-cyan animate-pulse'
              : 'border-jarvis-border text-jarvis-fg-dim hover:border-jarvis-cyan-dim hover:text-jarvis-cyan'
          }`}
          title={listening ? (isSpeaking ? 'Paused — JARVIS speaking' : 'Listening — click to stop') : 'Start voice input'}
        >
          {listening ? <Mic size={16} /> : <MicOff size={16} />}
        </button>

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!text.trim() || isStreaming}
          className="w-9 h-9 rounded-sm border border-jarvis-cyan-dim text-jarvis-cyan flex items-center justify-center cursor-pointer transition-all flex-shrink-0 hover:bg-jarvis-cyan-glow disabled:opacity-20 disabled:cursor-not-allowed"
        >
          <Send size={16} />
        </button>
      </div>

      <div className="text-center mt-1.5 font-mono text-[0.5rem] text-jarvis-fg-dim tracking-[0.08em]">
        {isSpeaking
          ? 'JARVIS SPEAKING · MIC PAUSED · ESC TO INTERRUPT'
          : listening
          ? voiceMode === 'cold'
            ? 'SAY “JARVIS” TO ACTIVATE · ESC TO INTERRUPT'
            : 'CONVERSATION MODE · SPEAK FREELY · ESC TO INTERRUPT'
          : 'CLICK MIC TO SPEAK · ENTER TO SEND · ESC TO INTERRUPT'}
      </div>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}
