export default function ThinkingDots() {
  return (
    <div className="flex gap-1 py-1">
      <span className="w-1 h-1 rounded-full bg-jarvis-amber animate-dot-bounce" />
      <span className="w-1 h-1 rounded-full bg-jarvis-amber animate-dot-bounce [animation-delay:0.15s]" />
      <span className="w-1 h-1 rounded-full bg-jarvis-amber animate-dot-bounce [animation-delay:0.3s]" />
    </div>
  );
}
