import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  variant?: 'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'dim';
}

const variants = {
  cyan: 'border-jarvis-cyan-dim text-jarvis-cyan bg-jarvis-cyan-glow',
  green: 'border-jarvis-green/30 text-jarvis-green bg-jarvis-green/5',
  amber: 'border-jarvis-amber/30 text-jarvis-amber bg-jarvis-amber/5',
  red: 'border-jarvis-red/30 text-jarvis-red bg-jarvis-red/5',
  purple: 'border-jarvis-purple/30 text-jarvis-purple bg-jarvis-purple/5',
  dim: 'border-jarvis-border text-jarvis-fg-dim',
};

export default function Badge({ children, variant = 'dim' }: Props) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 font-mono text-[0.6rem] tracking-wider uppercase border rounded-sm ${variants[variant]}`}>
      {children}
    </span>
  );
}
