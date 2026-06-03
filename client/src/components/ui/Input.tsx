import type { InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export default function Input({ label, className = '', ...props }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-jarvis-fg-dim">
          {label}
        </label>
      )}
      <input
        className={`bg-[rgba(0,20,40,0.3)] border border-jarvis-border rounded-sm px-3 py-2 text-jarvis-fg font-sans text-[0.85rem] outline-none focus:border-jarvis-cyan-dim transition-colors placeholder:text-jarvis-fg-dim placeholder:text-[0.75rem] ${className}`}
        {...props}
      />
    </div>
  );
}
