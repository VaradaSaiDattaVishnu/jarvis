import { useAppStore } from '../../stores/app';

export default function BootScreen() {
  const boot = useAppStore((s) => s.boot);

  return (
    <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center bg-jarvis-bg">
      <div className="font-mono text-[2.5rem] font-bold tracking-[0.4em] text-jarvis-cyan animate-boot-glow">
        J.A.R.V.I.S
      </div>
      <div className="font-mono text-[0.65rem] tracking-[0.3em] text-jarvis-fg-dim mt-3 uppercase">
        Just A Rather Very Intelligent System
      </div>
      <button
        onClick={boot}
        className="mt-12 px-10 py-3 font-mono text-[0.8rem] tracking-[0.2em] uppercase text-jarvis-cyan
          bg-transparent border border-jarvis-cyan-dim rounded-sm cursor-pointer
          hover:bg-jarvis-cyan-glow hover:border-jarvis-cyan hover:glow-cyan
          animate-boot-pulse transition-all duration-300"
      >
        INITIALIZE
      </button>
    </div>
  );
}
