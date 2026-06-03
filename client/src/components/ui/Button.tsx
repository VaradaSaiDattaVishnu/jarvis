import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

const variants = {
  primary: 'border-jarvis-cyan-dim text-jarvis-cyan hover:bg-jarvis-cyan-glow hover:border-jarvis-cyan',
  secondary: 'border-jarvis-border text-jarvis-fg-dim hover:border-jarvis-cyan-dim hover:text-jarvis-cyan',
  danger: 'border-jarvis-red/40 text-jarvis-red hover:bg-jarvis-red/10 hover:border-jarvis-red',
  ghost: 'border-transparent text-jarvis-fg-dim hover:text-jarvis-cyan hover:bg-[rgba(0,180,216,0.05)]',
};

const sizes = {
  sm: 'px-3 py-1 text-[0.6rem]',
  md: 'px-4 py-2 text-[0.7rem]',
  lg: 'px-6 py-2.5 text-[0.75rem]',
};

export default function Button({ variant = 'primary', size = 'md', children, className = '', ...props }: Props) {
  return (
    <button
      className={`font-mono tracking-[0.1em] uppercase border rounded-sm cursor-pointer transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
