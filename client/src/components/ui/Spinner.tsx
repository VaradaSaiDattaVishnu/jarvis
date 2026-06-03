interface Props {
  size?: 'sm' | 'md' | 'lg';
}

const sizes = {
  sm: 'w-4 h-4 border',
  md: 'w-6 h-6 border-2',
  lg: 'w-10 h-10 border-2',
};

export default function Spinner({ size = 'md' }: Props) {
  return (
    <div className={`${sizes[size]} border-jarvis-border border-t-jarvis-cyan rounded-full animate-spin`} />
  );
}
