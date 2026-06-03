import { useAppStore } from '../../stores/app';
import { useChatStore } from '../../stores/chat';
import { ws } from '../../api/websocket';

const VOICES = [
  { group: 'Male', voices: [
    { id: 'en-US-GuyNeural', label: 'Guy' },
    { id: 'en-US-ChristopherNeural', label: 'Christopher' },
    { id: 'en-US-EricNeural', label: 'Eric' },
    { id: 'en-IN-PrabhatNeural', label: 'Prabhat' },
  ]},
  { group: 'Female', voices: [
    { id: 'en-US-JennyNeural', label: 'Jenny' },
    { id: 'en-US-AriaNeural', label: 'Aria' },
    { id: 'en-IN-NeerjaNeural', label: 'Neerja' },
  ]},
];

export default function TopBar() {
  const connected = useAppStore((s) => s.connected);
  const memoryCount = useAppStore((s) => s.memoryCount);
  const calendarConnected = useAppStore((s) => s.calendarConnected);
  const coreState = useChatStore((s) => s.coreState);
  const selectedVoice = useChatStore((s) => s.selectedVoice);
  const setSelectedVoice = useChatStore((s) => s.setSelectedVoice);

  const handleVoiceChange = (voice: string) => {
    setSelectedVoice(voice);
    ws.send({ type: 'set_voice', voice });
  };

  const dotClass = coreState === 'thinking'
    ? 'bg-jarvis-amber shadow-[0_0_6px] shadow-jarvis-amber animate-hud-blink'
    : connected
      ? 'bg-jarvis-green shadow-[0_0_6px] shadow-jarvis-green'
      : 'bg-jarvis-red shadow-[0_0_6px] shadow-jarvis-red';

  return (
    <div className="flex items-center justify-between px-4 py-2.5 z-10 font-mono text-[0.65rem] tracking-[0.08em] text-jarvis-fg-dim border-b border-jarvis-border glass">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className={`w-[5px] h-[5px] rounded-full ${dotClass}`} />
          <span>{connected ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
      </div>

      <span className="text-[0.75rem] tracking-[0.25em] text-jarvis-cyan text-glow-cyan md:hidden">
        J.A.R.V.I.S
      </span>

      <div className="flex items-center gap-3">
        <span className="hidden sm:inline px-2 py-0.5 border border-jarvis-border rounded-sm text-[0.6rem]">
          {memoryCount} MEMORIES
        </span>

        {calendarConnected && (
          <span className="hidden sm:inline px-2 py-0.5 border border-[rgba(34,197,94,0.3)] rounded-sm text-jarvis-green text-[0.6rem]">
            CAL
          </span>
        )}

        <select
          value={selectedVoice}
          onChange={(e) => handleVoiceChange(e.target.value)}
          className="bg-transparent border border-jarvis-border text-jarvis-fg-dim font-mono text-[0.6rem] px-1.5 py-0.5 rounded-sm outline-none cursor-pointer [&>option]:bg-[#0a1628]"
        >
          {VOICES.map(({ group, voices }) => (
            <optgroup key={group} label={group}>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
    </div>
  );
}
