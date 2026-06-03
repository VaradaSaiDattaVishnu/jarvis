import { create } from 'zustand';
import type { Task } from '../types';
import * as api from '../api/endpoints';

interface TasksState {
  tasks: Task[];
  loading: boolean;
  filter: string | null;

  fetchTasks: (status?: string) => Promise<void>;
  addTask: (content: string, priority?: string, due_date?: string, sync_calendar?: boolean) => Promise<{ calendarSync?: { synced: boolean; eventId?: string; error?: string } } | undefined>;
  complete: (id: number) => Promise<void>;
  remove: (id: number) => Promise<void>;
  update: (id: number, data: Partial<Task>) => Promise<void>;
  setFilter: (filter: string | null) => void;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  loading: false,
  filter: null,

  fetchTasks: async (status) => {
    set({ loading: true });
    try {
      const { tasks } = await api.getTasks(status || get().filter || undefined);
      set({ tasks, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  addTask: async (content, priority, due_date, sync_calendar) => {
    const result = await api.createTask(content, priority, due_date, sync_calendar);
    await get().fetchTasks();
    return result; // caller can surface calendarSync (#49)
  },

  complete: async (id) => {
    await api.completeTask(id);
    get().fetchTasks();
  },

  remove: async (id) => {
    await api.deleteTask(id);
    get().fetchTasks();
  },

  update: async (id, data) => {
    await api.updateTask(id, data);
    get().fetchTasks();
  },

  setFilter: (filter) => set({ filter }),
}));
