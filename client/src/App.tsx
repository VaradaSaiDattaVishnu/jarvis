import { lazy, Suspense, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAppStore } from './stores/app';
import { useChatStore } from './stores/chat';
import { ws } from './api/websocket';
import { setApiSessionId } from './api/client';
import { getSetupStatus, markFollowUpDone } from './api/endpoints';
import type { WSMessage } from './types';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import MobileNav from './components/layout/MobileNav';
import BootScreen from './components/chat/BootScreen';
import PinGate from './components/auth/PinGate';
import { ToastContainer, showToast } from './components/ui/Toast';

// Lazy-loaded pages
const ChatView = lazy(() => import('./components/chat/ChatView'));
const DashboardView = lazy(() => import('./components/dashboard/DashboardView'));
const TasksView = lazy(() => import('./components/tasks/TasksView'));
const NotesView = lazy(() => import('./components/notes/NotesView'));
const DocumentsView = lazy(() => import('./components/documents/DocumentsView'));
const MemoryView = lazy(() => import('./components/memory/MemoryView'));
const IntegrationsView = lazy(() => import('./components/integrations/IntegrationsView'));
const SettingsView = lazy(() => import('./components/settings/SettingsView'));
const SetupWizard = lazy(() => import('./components/setup/SetupWizard'));

function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="font-mono text-xs tracking-widest text-jarvis-cyan-dim animate-pulse">
        LOADING MODULE...
      </div>
    </div>
  );
}

function AppLayout() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/chat" element={<ChatView />} />
            <Route path="/dashboard" element={<DashboardView />} />
            <Route path="/tasks" element={<TasksView />} />
            <Route path="/notes" element={<NotesView />} />
            <Route path="/documents" element={<DocumentsView />} />
            <Route path="/memory" element={<MemoryView />} />
            <Route path="/integrations" element={<IntegrationsView />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </Suspense>
      </div>
      <MobileNav />
    </div>
  );
}

export default function App() {
  const navigate = useNavigate();
  const booted = useAppStore((s) => s.booted);
  const setConnected = useAppStore((s) => s.setConnected);
  const setStats = useAppStore((s) => s.setStats);
  const setCalendarConnected = useAppStore((s) => s.setCalendarConnected);
  const setAssistantName = useAppStore((s) => s.setAssistantName);
  const setProvider = useAppStore((s) => s.setProvider);
  const setAuthRequired = useAppStore((s) => s.setAuthRequired);
  const setAuthenticated = useAppStore((s) => s.setAuthenticated);

  const setSessionId = useChatStore((s) => s.setSessionId);
  const startStreaming = useChatStore((s) => s.startStreaming);
  const appendChunk = useChatStore((s) => s.appendChunk);
  const completeResponse = useChatStore((s) => s.completeResponse);
  const setCoreState = useChatStore((s) => s.setCoreState);
  const setIsSpeaking = useChatStore((s) => s.setIsSpeaking);
  const setToolActivity = useChatStore((s) => s.setToolActivity);

  // ─── First-run gating: send the user to the wizard if no LLM is configured ──
  useEffect(() => {
    getSetupStatus()
      .then((s) => { if (s.needsSetup) navigate('/setup'); })
      .catch(() => { /* server unreachable — let the WS layer surface it */ });
  }, [navigate]);

  // ─── Audio queue ─────────────────────────────────────────
  // Audio chunks arrive with an index — play them in order
  const audioQueueRef = useRef<Map<number, string>>(new Map());
  const nextPlayIndexRef = useRef(0);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);

  const playNextFromQueue = useCallback(() => {
    const queue = audioQueueRef.current;
    const nextIdx = nextPlayIndexRef.current;

    if (!queue.has(nextIdx)) {
      // Next chunk hasn't arrived yet — wait for it
      isPlayingRef.current = false;
      return;
    }

    const url = queue.get(nextIdx)!;
    queue.delete(nextIdx);
    nextPlayIndexRef.current = nextIdx + 1;
    isPlayingRef.current = true;

    const audio = new Audio(url);
    currentAudioRef.current = audio;

    audio.onplay = () => {
      setCoreState('speaking');
      setIsSpeaking(true);
    };

    audio.onended = () => {
      currentAudioRef.current = null;
      // Check if there are more chunks waiting
      if (audioQueueRef.current.has(nextPlayIndexRef.current)) {
        playNextFromQueue();
      } else {
        isPlayingRef.current = false;
        setIsSpeaking(false);
        // Only go idle if streaming is also done
        if (!useChatStore.getState().isStreaming) {
          const mode = useChatStore.getState().voiceMode;
          setCoreState(mode === 'conversation' ? 'passive' : 'idle');
        }
      }
    };

    audio.onerror = () => {
      currentAudioRef.current = null;
      playNextFromQueue();
    };

    audio.play().catch(() => {
      // Browser autoplay policy blocked — degrade gracefully
      currentAudioRef.current = null;
      isPlayingRef.current = false;
      setIsSpeaking(false);
    });
  }, [setCoreState, setIsSpeaking]);

  const stopAudio = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.src = '';
      currentAudioRef.current = null;
    }
    audioQueueRef.current.clear();
    nextPlayIndexRef.current = 0;
    isPlayingRef.current = false;
    setIsSpeaking(false);
  }, [setIsSpeaking]);

  // ─── WebSocket message handler ────────────────────────────
  useEffect(() => {
    const unsub = ws.subscribe((msg: WSMessage) => {
      switch (msg.type) {
        case 'connected':
          setConnected(true);
          setSessionId(msg.sessionId);
          setApiSessionId(msg.sessionId); // attach x-session-id to auth-gated REST calls
          setStats(msg.stats);
          setCalendarConnected(msg.calendarConnected);
          if (msg.provider) setProvider(msg.provider);
          setAuthRequired(msg.authRequired);
          // Derive auth state from the (fresh) session every (re)connect: a new
          // server sessionId is unauthenticated, so re-lock when a PIN is set (#9).
          setAuthenticated(!msg.authRequired);
          if (msg.name) setAssistantName(msg.name);
          setCoreState('idle');
          break;

        case 'thinking':
          stopAudio();
          startStreaming();
          setCoreState('thinking');
          break;

        case 'text_chunk':
          // Keep accumulating text. Do NOT flip to 'speaking' here — that's driven
          // solely by audio playback (audio.onplay), so the orb stays in 'thinking'
          // until JARVIS actually starts talking (#47).
          appendChunk(msg.text);
          break;

        case 'tool':
          setToolActivity(msg.status === 'start' ? msg.name : null);
          break;

        case 'follow_up':
          showToast(`💭 Following up: ${msg.topic}`, 'info');
          // Ack so the server doesn't keep re-sending it on the next sweep (#12).
          markFollowUpDone(msg.id).catch(() => {});
          break;

        case 'auth_required':
          setAuthRequired(true);
          setAuthenticated(false);
          setCoreState('idle');
          break;

        case 'auth_result':
          if (msg.success) {
            setAuthenticated(true);
            showToast('🔓 Unlocked', 'success');
          } else {
            showToast(msg.error || 'Incorrect PIN', 'error');
          }
          break;

        case 'audio': {
          // Enqueue by index and start playing if not already
          audioQueueRef.current.set(msg.index, msg.url);
          if (!isPlayingRef.current) {
            playNextFromQueue();
          }
          break;
        }

        case 'response_complete':
          completeResponse();
          // After streaming ends, if audio queue is already drained → go idle
          setTimeout(() => {
            if (!isPlayingRef.current && audioQueueRef.current.size === 0) {
              // Reset the per-response audio cursor so the NEXT turn's index-0 chunk
              // plays even if it arrives without a preceding 'thinking' (#6 defense).
              nextPlayIndexRef.current = 0;
              const mode = useChatStore.getState().voiceMode;
              setCoreState(mode === 'conversation' ? 'passive' : 'idle');
              setIsSpeaking(false);
            }
          }, 200);
          break;

        case 'interrupted': {
          stopAudio();
          completeResponse();
          // Stay in the passive listening state during continuous voice mode,
          // matching the other terminal paths (#14).
          const mode = useChatStore.getState().voiceMode;
          setCoreState(mode === 'conversation' ? 'passive' : 'idle');
          break;
        }

        case 'error':
          console.error('WS error:', msg.message);
          setCoreState('idle');
          break;

        case 'voice_changed':
          useChatStore.setState({ selectedVoice: msg.voice });
          break;

        case 'reminder':
          showToast(`⏰ ${msg.content}`, 'info');
          break;
      }
    });

    ws.connect();

    return () => {
      unsub();
      stopAudio();
      ws.disconnect();
    };
  }, []);

  if (!booted) {
    return <BootScreen />;
  }

  return (
    <>
      <ToastContainer />
      <PinGate />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/setup" element={<SetupWizard />} />
          <Route path="/*" element={<AppLayout />} />
        </Routes>
      </Suspense>
    </>
  );
}
