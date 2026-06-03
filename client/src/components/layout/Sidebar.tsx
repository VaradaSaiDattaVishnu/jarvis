import { useLocation, useNavigate } from 'react-router-dom';
import {
  MessageSquare, LayoutDashboard, CheckSquare, StickyNote, FileText,
  Brain, Plug, Settings, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useAppStore } from '../../stores/app';

const NAV_ITEMS = [
  { path: '/chat', icon: MessageSquare, label: 'Chat' },
  { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/tasks', icon: CheckSquare, label: 'Tasks' },
  { path: '/notes', icon: StickyNote, label: 'Notes' },
  { path: '/documents', icon: FileText, label: 'Documents' },
  { path: '/memory', icon: Brain, label: 'Memory' },
  { path: '/integrations', icon: Plug, label: 'Integrations' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggle = useAppStore((s) => s.toggleSidebar);

  return (
    <aside className={`hidden md:flex flex-col border-r border-jarvis-border glass transition-all duration-300 ${
      collapsed ? 'w-16' : 'w-56'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-jarvis-border">
        {!collapsed && (
          <span className="font-mono text-xs tracking-[0.2em] text-jarvis-cyan text-glow-cyan">
            J.A.R.V.I.S
          </span>
        )}
        <button
          onClick={toggle}
          className="p-1 text-jarvis-fg-dim hover:text-jarvis-cyan transition-colors"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2">
        {NAV_ITEMS.map(({ path, icon: Icon, label }) => {
          const active = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-200 ${
                active
                  ? 'text-jarvis-cyan bg-[rgba(0,180,216,0.08)] border-r-2 border-jarvis-cyan'
                  : 'text-jarvis-fg-dim hover:text-jarvis-fg hover:bg-[rgba(0,180,216,0.03)]'
              }`}
              title={collapsed ? label : undefined}
            >
              <Icon size={18} className="flex-shrink-0" />
              {!collapsed && (
                <span className="font-mono text-[0.7rem] tracking-[0.08em] uppercase">
                  {label}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-jarvis-border">
        {!collapsed && (
          <div className="font-mono text-[0.5rem] text-jarvis-fg-dim tracking-wider">
            v1.0.0
          </div>
        )}
      </div>
    </aside>
  );
}
