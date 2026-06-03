import type { Message } from '../../types';

interface Props {
  message: Message;
}

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <div className="py-3 animate-msg-fade border-b border-[rgba(0,180,216,0.05)] last:border-b-0">
      <div className={`font-mono text-[0.55rem] tracking-[0.2em] uppercase mb-1 ${
        isUser ? 'text-jarvis-cyan' : 'text-jarvis-purple'
      }`}>
        {isUser && '> '}{message.role}
      </div>
      <div className={`font-sans text-[0.9rem] leading-[1.7] font-light ${
        isUser ? 'text-jarvis-fg' : 'text-jarvis-fg/85'
      }`}>
        {message.text}
      </div>
    </div>
  );
}
