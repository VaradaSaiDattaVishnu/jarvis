import { useEffect, useState } from 'react';
import { Brain, Users, Tags, Trash2, Search } from 'lucide-react';
import { useMemoryStore } from '../../stores/memory';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Spinner from '../ui/Spinner';
import Tabs from '../ui/Tabs';
import Input from '../ui/Input';
import Modal from '../ui/Modal';

const MEMORY_TABS = [
  { id: 'memories', label: 'Memories' },
  { id: 'relationships', label: 'People' },
  { id: 'preferences', label: 'Preferences' },
];

export default function MemoryView() {
  const { memories, relationships, preferences, loading, fetchAll, deleteMemory, forgetTopic } = useMemoryStore();
  const [tab, setTab] = useState('memories');
  const [searchTerm, setSearchTerm] = useState('');
  const [showForget, setShowForget] = useState(false);
  const [forgetInput, setForgetInput] = useState('');

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleForget = async () => {
    if (!forgetInput.trim()) return;
    await forgetTopic(forgetInput.trim());
    setForgetInput('');
    setShowForget(false);
  };

  const filteredMemories = searchTerm
    ? memories.filter((m) => m.content.toLowerCase().includes(searchTerm.toLowerCase()) || m.keywords?.toLowerCase().includes(searchTerm.toLowerCase()))
    : memories;

  if (loading && memories.length === 0) {
    return <div className="flex-1 flex items-center justify-center"><Spinner size="lg" /></div>;
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-mono text-xs tracking-[0.2em] uppercase text-jarvis-cyan text-glow-cyan">
          Memory Browser
        </h1>
        <Button variant="danger" size="sm" onClick={() => setShowForget(true)}>
          Forget Topic
        </Button>
      </div>

      <Tabs tabs={MEMORY_TABS} activeTab={tab} onChange={setTab} />

      <div className="mt-4">
        {tab === 'memories' && (
          <>
            <div className="relative mb-4">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-jarvis-fg-dim" />
              <input
                type="text"
                placeholder="Search memories..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-[rgba(0,20,40,0.3)] border border-jarvis-border rounded-sm pl-9 pr-3 py-2 text-jarvis-fg font-sans text-sm outline-none focus:border-jarvis-cyan-dim transition-colors placeholder:text-jarvis-fg-dim"
              />
            </div>

            {filteredMemories.length === 0 ? (
              <p className="text-center py-8 text-jarvis-fg-dim font-mono text-sm">No memories found</p>
            ) : (
              <div className="space-y-2">
                {filteredMemories.map((mem) => (
                  <Card key={mem.id}>
                    <div className="flex items-start gap-3">
                      <Brain size={16} className="text-jarvis-cyan flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-jarvis-fg">{mem.content}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <Badge variant="cyan">{mem.category}</Badge>
                          <span className="font-mono text-[0.5rem] text-jarvis-fg-dim">
                            importance: {mem.importance}
                          </span>
                          <span className="font-mono text-[0.5rem] text-jarvis-fg-dim">
                            {new Date(mem.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => deleteMemory(mem.id)}
                        className="text-jarvis-fg-dim hover:text-jarvis-red transition-colors p-1 flex-shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'relationships' && (
          relationships.length === 0 ? (
            <p className="text-center py-8 text-jarvis-fg-dim font-mono text-sm">No relationships tracked yet</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {relationships.map((rel) => (
                <Card key={rel.id}>
                  <div className="flex items-start gap-3">
                    <Users size={16} className="text-jarvis-purple flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-jarvis-fg">{rel.person_name}</div>
                      <div className="text-[0.75rem] text-jarvis-fg/70 mt-0.5">{rel.relationship_type}</div>
                      {rel.context && <div className="text-[0.7rem] text-jarvis-fg-dim mt-1">{rel.context}</div>}
                      <div className="mt-1.5">
                        <Badge variant="dim">{rel.mention_count} mentions</Badge>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )
        )}

        {tab === 'preferences' && (
          preferences.length === 0 ? (
            <p className="text-center py-8 text-jarvis-fg-dim font-mono text-sm">No preferences learned yet</p>
          ) : (
            <div className="space-y-2">
              {preferences.map((pref) => (
                <Card key={pref.id}>
                  <div className="flex items-center gap-3">
                    <Tags size={16} className="text-jarvis-green flex-shrink-0" />
                    <div className="flex-1">
                      <div className="text-sm text-jarvis-fg">{pref.preference}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="dim">{pref.category}</Badge>
                        <Badge variant={pref.source === 'explicit' ? 'cyan' : 'dim'}>{pref.source}</Badge>
                        <span className="font-mono text-[0.5rem] text-jarvis-fg-dim">
                          confidence: {(pref.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )
        )}
      </div>

      <Modal open={showForget} onClose={() => setShowForget(false)} title="Forget Topic">
        <div className="space-y-4">
          <p className="text-sm text-jarvis-fg/70">
            This will permanently delete all memories related to the given topic.
          </p>
          <Input
            label="Topic"
            placeholder="e.g., my medical records"
            value={forgetInput}
            onChange={(e) => setForgetInput(e.target.value)}
            autoFocus
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowForget(false)}>Cancel</Button>
            <Button variant="danger" onClick={handleForget} disabled={!forgetInput.trim()}>Forget</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
