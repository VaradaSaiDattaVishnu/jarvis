import type { SelectHTMLAttributes } from 'react';

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
}

export default function Select({ label, options, className = '', ...props }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-jarvis-fg-dim">
          {label}
        </label>
      )}
      <select
        className={`bg-[rgba(0,20,40,0.3)] border border-jarvis-border rounded-sm px-3 py-2 text-jarvis-fg font-sans text-[0.85rem] outline-none focus:border-jarvis-cyan-dim cursor-pointer transition-colors [&>option]:bg-[#0a1628] ${className}`}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
