import { useEffect, useRef } from 'react';
import { Wrench } from 'lucide-react';
import { useChatStore } from '../../stores/chat';
import MessageBubble from './MessageBubble';
import ThinkingDots from './ThinkingDots';

const TOOL_LABELS: Record<string, string> = {
  set_reminder: 'Setting a reminder',
  list_reminders: 'Checking reminders',
  create_task: 'Creating a task',
  list_tasks: 'Checking tasks',
  complete_task: 'Completing a task',
  search_memory: 'Searching memory',
  save_note: 'Saving a note',
  search_notes: 'Searching notes',
  search_documents: 'Searching your documents',
  get_integration_status: 'Checking integrations',
  web_search: 'Searching the web',
  get_news: 'Fetching the news',
  get_weather: 'Checking the weather',
  get_calendar: 'Checking your calendar',
  create_calendar_event: 'Creating a calendar event',
  get_recent_emails: 'Reading recent emails',
  send_email: 'Sending an email',
  list_smart_home_devices: 'Listing smart-home devices',
  control_smart_home: 'Controlling smart home',
  control_music: 'Controlling music',
  get_current_time: 'Checking the time',
};

function toolLabel(name: string) {
  return TOOL_LABELS[name] || `Using ${name.replace(/_/g, ' ')}`;
}

export default function MessageList() {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const currentChunk = useChatStore((s) => s.currentChunk);
  const toolActivity = useChatStore((s) => s.toolActivity);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentChunk, toolActivity]);

  const empty = messages.length === 0 && !isStreaming;

  return (
    <div className="flex-1 overflow-y-auto px-4 md:px-6 pb-4 flex flex-col gap-0 scroll-smooth relative z-[1]">
      {empty && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-12">
          <div className="font-mono text-[0.7rem] tracking-[0.15em] uppercase text-jarvis-cyan-dim mb-3">
            How can I help?
          </div>
          <p className="text-sm text-jarvis-fg/60 max-w-sm leading-relaxed">
            Ask me anything — I can set reminders, manage tasks, search the web, read your
            documents, check your calendar, and more. Try{' '}
            <span className="text-jarvis-fg/80">"remind me to call mom at 5pm"</span> or{' '}
            <span className="text-jarvis-fg/80">"what's on my calendar today?"</span>
          </p>
        </div>
      )}

      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}

      {/* Streaming response */}
      {isStreaming && (
        <div className="py-3 animate-msg-fade">
          <div className="font-mono text-[0.55rem] tracking-[0.2em] uppercase mb-1 text-jarvis-purple">
            assistant
          </div>

          {/* Tool-call chip while a tool is executing */}
          {toolActivity && (
            <div className="inline-flex items-center gap-1.5 mb-2 px-2 py-1 rounded-sm border border-jarvis-cyan-dim bg-jarvis-cyan-glow">
              <Wrench size={11} className="text-jarvis-cyan animate-pulse" />
              <span className="font-mono text-[0.55rem] tracking-wider uppercase text-jarvis-cyan">
                {toolLabel(toolActivity)}…
              </span>
            </div>
          )}

          {currentChunk ? (
            <div className="font-sans text-[0.9rem] leading-[1.7] font-light text-jarvis-fg/85">
              {currentChunk}
              <span className="inline-block w-[2px] h-[1em] bg-jarvis-cyan ml-0.5 animate-pulse align-middle" />
            </div>
          ) : (
            !toolActivity && <ThinkingDots />
          )}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
