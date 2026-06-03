interface Props {
  tabs: { id: string; label: string }[];
  activeTab: string;
  onChange: (id: string) => void;
}

export default function Tabs({ tabs, activeTab, onChange }: Props) {
  return (
    <div className="flex gap-0 border-b border-jarvis-border">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`px-4 py-2 font-mono text-[0.65rem] tracking-[0.1em] uppercase transition-all duration-200 border-b-2 -mb-px ${
            activeTab === tab.id
              ? 'text-jarvis-cyan border-jarvis-cyan'
              : 'text-jarvis-fg-dim border-transparent hover:text-jarvis-fg hover:border-jarvis-border'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
