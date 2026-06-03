import { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { useAppStore } from '../../stores/app';
import { ws } from '../../api/websocket';
import { showToast } from '../ui/Toast';
import Button from '../ui/Button';

// Full-screen lock shown when the server reports a PIN is set and this session
// isn't authenticated yet. Submitting sends a WS `authenticate` message; the
// server replies with `auth_result`, which flips `authenticated` in the store.
export default function PinGate() {
  const authRequired = useAppStore((s) => s.authRequired);
  const authenticated = useAppStore((s) => s.authenticated);
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the re-enable timer on unmount (component unmounts on successful auth).
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  if (!authRequired || authenticated) return null;

  const submit = () => {
    if (pin.length < 4) return;
    if (!ws.connected) {
      showToast('Reconnecting — try again in a moment.', 'error');
      return;
    }
    setSubmitting(true);
    ws.send({ type: 'authenticate', pin });
    setPin('');
    // auth_result normally flips `authenticated` (unmounting us) well within this
    // window; the timer just re-enables the button if the PIN was wrong.
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setSubmitting(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-jarvis-bg/95 backdrop-blur-sm">
      <div className="w-full max-w-xs text-center px-6">
        <div className="w-14 h-14 rounded-full bg-jarvis-cyan-glow border border-jarvis-cyan-dim flex items-center justify-center mx-auto mb-5">
          <Lock size={24} className="text-jarvis-cyan" />
        </div>
        <h2 className="font-mono text-sm tracking-[0.2em] uppercase text-jarvis-cyan mb-2">Locked</h2>
        <p className="text-[0.8rem] text-jarvis-fg/60 mb-6">Enter your PIN to unlock JARVIS.</p>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="••••"
          className="w-full text-center tracking-[0.5em] bg-[rgba(0,20,40,0.4)] border border-jarvis-border rounded-sm px-3 py-3 text-jarvis-fg font-mono text-lg outline-none focus:border-jarvis-cyan-dim transition-colors mb-4"
        />
        <Button onClick={submit} disabled={pin.length < 4 || submitting} className="w-full">
          {submitting ? 'Unlocking…' : 'Unlock'}
        </Button>
      </div>
    </div>
  );
}
