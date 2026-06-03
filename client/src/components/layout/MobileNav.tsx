import { useLocation, useNavigate } from 'react-router-dom';
import {
  MessageSquare, LayoutDashboard, CheckSquare, FileText, Brain, Settings,
} from 'lucide-react';

const NAV_ITEMS = [
  { path: '/chat', icon: MessageSquare, label: 'Chat' },
  { path: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  { path: '/tasks', icon: CheckSquare, label: 'Tasks' },
  { path: '/documents', icon: FileText, label: 'Docs' },
  { path: '/memory', icon: Brain, label: 'Memory' },
  { path: '/settings', icon: Settings, label: 'More' },
];

export default function MobileNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around py-2 border-t border-jarvis-border glass">
      {NAV_ITEMS.map(({ path, icon: Icon, label }) => {
        const active = location.pathname === path;
        return (
          <button
            key={path}
            onClick={() => navigate(path)}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 transition-colors ${
              active ? 'text-jarvis-cyan' : 'text-jarvis-fg-dim'
            }`}
          >
            <Icon size={20} />
            <span className="font-mono text-[0.5rem] tracking-wider">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
