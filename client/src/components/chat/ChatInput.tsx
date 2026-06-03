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
  const listeningRef = useRef(false);

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

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      // Don't pick up JARVIS's own voice while audio is playing
      if (useChatStore.getState().isSpeaking) return;

      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }

      const currentMode = useChatStore.getState().voiceMode;

      if (currentMode === 'cold') {
        if (transcript.toLowerCase().includes('jarvis')) {
          setVoiceMode('conversation');
          setCoreState('passive');
        }
        return;
      }

      // Conversation mode — auto-send on silence
      if (event.results[event.resultIndex].isFinal) {
        const finalText = transcript.trim();
        if (finalText) {
          sendMessage(finalText);
          ws.send({ type: 'message', text: finalText });
        }
      } else {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        setCoreState('active');
        silenceTimerRef.current = setTimeout(() => setCoreState('passive'), 1500);
      }
    };

    recognition.onerror = (e: any) => {
      if (e.error !== 'no-speech') setListen(false);
    };

    recognition.onend = () => {
      // Auto-restart only if listening and JARVIS is not currently speaking
      if (listeningRef.current && !useChatStore.getState().isSpeaking) {
        try { recognition.start(); } catch { /* ignore duplicate start */ }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListen(true);
    setCoreState(voiceMode === 'cold' ? 'idle' : 'passive');
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListen(false);
    setVoiceMode('cold');
    setCoreState('idle');
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
  };

  // ─── Pause mic while JARVIS speaks, resume after ─────────
  useEffect(() => {
    if (!listeningRef.current || !recognitionRef.current) return;

    if (isSpeaking) {
      // Suspend recognition so we don't hear JARVIS's own TTS output
      try { recognitionRef.current.stop(); } catch { /* ok */ }
    } else {
      // Audio finished — restart mic if in conversation mode
      if (useChatStore.getState().voiceMode === 'conversation') {
        try { recognitionRef.current.start(); } catch { /* already running */ }
      }
    }
  }, [isSpeaking]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
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
          ? 'JARVIS SPEAKING \u00B7 MIC PAUSED \u00B7 ESC TO INTERRUPT'
          : listening
          ? voiceMode === 'cold'
            ? 'SAY \u201CJARVIS\u201D TO ACTIVATE \u00B7 ESC TO INTERRUPT'
            : 'CONVERSATION MODE \u00B7 SPEAK FREELY \u00B7 ESC TO INTERRUPT'
          : 'CLICK MIC TO SPEAK \u00B7 ENTER TO SEND \u00B7 ESC TO INTERRUPT'}
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
