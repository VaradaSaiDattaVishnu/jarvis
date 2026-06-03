import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}

export default function Card({ children, className = '', hover, onClick }: Props) {
  return (
    <div
      onClick={onClick}
      className={`glass-surface border border-jarvis-border rounded-sm p-4 transition-all duration-200 ${
        hover ? 'hover:border-jarvis-cyan-dim hover:glow-cyan cursor-pointer' : ''
      } ${onClick ? 'cursor-pointer' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
