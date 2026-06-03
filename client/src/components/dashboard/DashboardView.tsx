import { useEffect, useState } from 'react';
import { Brain, CheckSquare, Clock, Plug, Calendar, AlertCircle, Sparkles } from 'lucide-react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Spinner from '../ui/Spinner';
import { useMonitorStore } from '../../stores/monitor';
import * as api from '../../api/endpoints';
import type { CalendarEvent, Task, ProactiveSuggestion } from '../../types';

function StatCard({ icon: Icon, label, value, color }: { icon: typeof Brain; label: string; value: string | number; color: string }) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-[0.55rem] tracking-[0.1em] uppercase text-jarvis-fg-dim mb-1">{label}</div>
          <div className={`text-2xl font-light ${color}`}>{value}</div>
        </div>
        <Icon size={20} className={color} />
      </div>
    </Card>
  );
}

export default function DashboardView() {
  const { health, fetchHealth, loading } = useMonitorStore();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskCount, setTaskCount] = useState(0);
  const [suggestions, setSuggestions] = useState<ProactiveSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);

  useEffect(() => {
    fetchHealth();
    api.getTodayEvents().then((d) => setEvents(d.events)).catch(() => {});
    api.getTasks('pending').then((d) => {
      setTaskCount(d.tasks.length);          // real count (not capped) (#32)
      setTasks(d.tasks.slice(0, 5));          // preview only
    }).catch(() => {});
    api.getProactiveSuggestions()
      .then((d) => setSuggestions(d.suggestions || []))
      .catch(() => {})
      .finally(() => setLoadingSuggestions(false));
  }, [fetchHealth]);

  if (loading && !health) {
    return <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>;
  }

  const priorityVariant = (p: string) => (p === 'high' ? 'red' : p === 'medium' ? 'amber' : 'dim');

  return (
    <div className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">
      <h1 className="font-mono text-xs tracking-[0.2em] uppercase text-jarvis-cyan mb-6 text-glow-cyan">
        Dashboard
      </h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Brain} label="Memories" value={health?.totalMemories ?? 0} color="text-jarvis-cyan" />
        <StatCard icon={CheckSquare} label="Pending Tasks" value={taskCount} color="text-jarvis-amber" />
        <StatCard icon={Clock} label="Uptime" value={health?.uptime ?? 'N/A'} color="text-jarvis-green" />
        <StatCard icon={Plug} label="LLM Avg" value={health?.llm?.avgLatencyMs ? `${health.llm.avgLatencyMs}ms` : 'N/A'} color="text-jarvis-purple" />
      </div>

      {/* Proactive Intelligence (Feature 3) */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={16} className="text-jarvis-purple" />
          <span className="font-mono text-[0.65rem] tracking-[0.1em] uppercase text-jarvis-purple">Proactive Intelligence</span>
        </div>
        {loadingSuggestions ? (
          <div className="flex items-center gap-2 text-jarvis-fg-dim text-sm py-2">
            <Spinner size="sm" /> Thinking ahead…
          </div>
        ) : suggestions.length === 0 ? (
          <p className="text-jarvis-fg-dim text-sm">Nothing needs your attention right now. Clear skies. ☀️</p>
        ) : (
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-3 py-1.5 border-b border-jarvis-border last:border-0">
                <div className="w-1.5 h-1.5 rounded-full bg-jarvis-purple/60 mt-1.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-jarvis-fg">{s.title}</span>
                    <Badge variant={priorityVariant(s.priority)}>{s.priority}</Badge>
                  </div>
                  {s.detail && <div className="text-[0.75rem] text-jarvis-fg-dim mt-0.5">{s.detail}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Calendar Preview */}
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={16} className="text-jarvis-cyan" />
            <span className="font-mono text-[0.65rem] tracking-[0.1em] uppercase text-jarvis-cyan">Today's Schedule</span>
          </div>
          {events.length === 0 ? (
            <p className="text-jarvis-fg-dim text-sm">No events today</p>
          ) : (
            <div className="space-y-2">
              {events.map((event) => (
                <div key={event.id} className="flex items-start gap-3 py-1.5 border-b border-jarvis-border last:border-0">
                  <span className="font-mono text-[0.6rem] text-jarvis-fg-dim whitespace-nowrap mt-0.5">
                    {event.allDay ? 'ALL DAY' : new Date(event.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <div>
                    <div className="text-sm text-jarvis-fg">{event.summary}</div>
                    {event.location && <div className="text-[0.7rem] text-jarvis-fg-dim">{event.location}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Tasks Preview */}
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <CheckSquare size={16} className="text-jarvis-amber" />
            <span className="font-mono text-[0.65rem] tracking-[0.1em] uppercase text-jarvis-amber">Pending Tasks</span>
          </div>
          {tasks.length === 0 ? (
            <p className="text-jarvis-fg-dim text-sm">No pending tasks</p>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <div key={task.id} className="flex items-center gap-2 py-1.5 border-b border-jarvis-border last:border-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-jarvis-amber/50" />
                  <span className="text-sm text-jarvis-fg flex-1">{task.content}</span>
                  <Badge variant={task.priority === 'high' ? 'red' : task.priority === 'medium' ? 'amber' : 'dim'}>
                    {task.priority}
                  </Badge>
                </div>
              ))}
              {taskCount > tasks.length && (
                <div className="text-[0.7rem] text-jarvis-fg-dim pt-1">+{taskCount - tasks.length} more</div>
              )}
            </div>
          )}
        </Card>

        {/* System Health */}
        {health && (
          <Card className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle size={16} className="text-jarvis-green" />
              <span className="font-mono text-[0.65rem] tracking-[0.1em] uppercase text-jarvis-green">System Health</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="font-mono text-[0.55rem] text-jarvis-fg-dim tracking-wider mb-1">LLM LATENCY (AVG)</div>
                <div className="text-lg text-jarvis-fg font-light">{health.llm?.avgLatencyMs ?? 0}ms</div>
              </div>
              <div>
                <div className="font-mono text-[0.55rem] text-jarvis-fg-dim tracking-wider mb-1">LLM LATENCY (P95)</div>
                <div className="text-lg text-jarvis-fg font-light">{health.llm?.p95LatencyMs ?? 0}ms</div>
              </div>
              <div>
                <div className="font-mono text-[0.55rem] text-jarvis-fg-dim tracking-wider mb-1">TTS LATENCY (AVG)</div>
                <div className="text-lg text-jarvis-fg font-light">{health.tts?.avgLatencyMs ?? 0}ms</div>
              </div>
              <div>
                <div className="font-mono text-[0.55rem] text-jarvis-fg-dim tracking-wider mb-1">LLM ERROR RATE</div>
                <div className="text-lg text-jarvis-fg font-light">{health.llm?.errorRate ?? '0%'}</div>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
