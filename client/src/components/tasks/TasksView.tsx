import { useEffect, useState } from 'react';
import { Plus, Check, Trash2, Calendar, CalendarCheck } from 'lucide-react';
import { useTasksStore } from '../../stores/tasks';
import { useAppStore } from '../../stores/app';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Spinner from '../ui/Spinner';
import Tabs from '../ui/Tabs';
import Toggle from '../ui/Toggle';

const STATUS_TABS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'done', label: 'Done' },
];

export default function TasksView() {
  const { tasks, loading, fetchTasks, addTask, complete, remove } = useTasksStore();
  const calendarConnected = useAppStore((s) => s.calendarConnected);
  const [tab, setTab] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTask, setNewTask] = useState({ content: '', priority: 'medium', due_date: '', sync_calendar: true });

  useEffect(() => {
    fetchTasks(tab === 'all' ? undefined : tab);
  }, [fetchTasks, tab]);

  const handleCreate = async () => {
    if (!newTask.content.trim()) return;
    setCreating(true);
    try {
      await addTask(newTask.content, newTask.priority, newTask.due_date || undefined, newTask.sync_calendar);
      setNewTask({ content: '', priority: 'medium', due_date: '', sync_calendar: true });
      setShowCreate(false);
    } finally {
      setCreating(false);
    }
  };

  const filtered = tab === 'all' ? tasks : tasks.filter((t) => t.status === tab);

  return (
    <div className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-mono text-xs tracking-[0.2em] uppercase text-jarvis-cyan text-glow-cyan">
            Tasks
          </h1>
          {calendarConnected && (
            <div className="flex items-center gap-1 mt-1">
              <CalendarCheck size={10} className="text-jarvis-green" />
              <span className="text-[0.6rem] text-jarvis-green font-mono">Calendar sync active</span>
            </div>
          )}
        </div>
        <Button onClick={() => setShowCreate(true)} size="sm">
          <span className="flex items-center gap-1.5"><Plus size={14} /> New Task</span>
        </Button>
      </div>

      <Tabs tabs={STATUS_TABS} activeTab={tab} onChange={setTab} />

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-jarvis-fg-dim font-mono text-sm">
          No tasks found
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {filtered.map((task) => (
            <Card key={task.id}>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => task.status !== 'done' && complete(task.id)}
                  className={`w-5 h-5 rounded-sm border flex items-center justify-center flex-shrink-0 transition-colors ${
                    task.status === 'done'
                      ? 'bg-jarvis-green/20 border-jarvis-green text-jarvis-green'
                      : 'border-jarvis-border hover:border-jarvis-cyan text-transparent hover:text-jarvis-cyan'
                  }`}
                >
                  <Check size={12} />
                </button>

                <div className="flex-1 min-w-0">
                  <div className={`text-sm ${task.status === 'done' ? 'line-through text-jarvis-fg-dim' : 'text-jarvis-fg'}`}>
                    {task.content}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {task.due_date && (
                      <span className="text-[0.65rem] text-jarvis-fg-dim">
                        Due: {new Date(task.due_date).toLocaleDateString()}
                      </span>
                    )}
                    {task.calendar_event_id && (
                      <span className="flex items-center gap-0.5 text-[0.6rem] text-jarvis-green">
                        <Calendar size={9} /> Synced
                      </span>
                    )}
                  </div>
                </div>

                <Badge variant={task.priority === 'high' ? 'red' : task.priority === 'medium' ? 'amber' : 'dim'}>
                  {task.priority}
                </Badge>

                <Badge variant={task.status === 'done' ? 'green' : task.status === 'in_progress' ? 'cyan' : 'dim'}>
                  {task.status}
                </Badge>

                <button
                  onClick={() => remove(task.id)}
                  className="text-jarvis-fg-dim hover:text-jarvis-red transition-colors p-1"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Task">
        <div className="space-y-4">
          <Input
            label="Task"
            placeholder="What needs to be done?"
            value={newTask.content}
            onChange={(e) => setNewTask({ ...newTask, content: e.target.value })}
            autoFocus
          />
          <Select
            label="Priority"
            value={newTask.priority}
            onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ]}
          />
          <Input
            label="Due Date"
            type="date"
            value={newTask.due_date}
            onChange={(e) => setNewTask({ ...newTask, due_date: e.target.value })}
          />

          {calendarConnected && newTask.due_date && (
            <div className="p-3 rounded border border-jarvis-green/20 bg-jarvis-green/5">
              <Toggle
                label="Sync to Google Calendar"
                enabled={newTask.sync_calendar}
                onChange={(enabled) => setNewTask({ ...newTask, sync_calendar: enabled })}
              />
              <p className="text-[0.65rem] text-jarvis-fg-dim mt-1 ml-[52px]">
                Creates a calendar event on the due date at 9:00 AM
              </p>
            </div>
          )}

          {!calendarConnected && newTask.due_date && (
            <div className="p-3 rounded border border-jarvis-amber/20 bg-jarvis-amber/5">
              <p className="text-[0.65rem] text-jarvis-amber font-mono">
                Connect Google Calendar in Integrations to auto-sync tasks
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newTask.content.trim() || creating}>
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
