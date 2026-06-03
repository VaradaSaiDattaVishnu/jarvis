interface Props {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label?: string;
}

export default function Toggle({ enabled, onChange, label }: Props) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className="flex items-center gap-3 cursor-pointer group"
    >
      <div className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${
        enabled ? 'bg-jarvis-cyan/30 border-jarvis-cyan' : 'bg-[rgba(0,20,40,0.6)] border-jarvis-border'
      } border`}>
        <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-200 ${
          enabled
            ? 'left-[calc(100%-18px)] bg-jarvis-cyan shadow-[0_0_8px_rgba(0,180,216,0.4)]'
            : 'left-0.5 bg-jarvis-fg-dim'
        }`} />
      </div>
      {label && (
        <span className="font-mono text-[0.7rem] tracking-[0.05em] text-jarvis-fg-dim group-hover:text-jarvis-fg transition-colors">
          {label}
        </span>
      )}
    </button>
  );
}
