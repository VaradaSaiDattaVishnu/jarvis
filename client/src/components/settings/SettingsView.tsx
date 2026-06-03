import { useEffect, useState } from 'react';
import { Mic, Bell, Shield, Database, Activity } from 'lucide-react';
import Tabs from '../ui/Tabs';
import Card from '../ui/Card';
import Button from '../ui/Button';
import Toggle from '../ui/Toggle';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Badge from '../ui/Badge';
import Spinner from '../ui/Spinner';
import { useSettingsStore } from '../../stores/settings';
import { useChatStore } from '../../stores/chat';
import { useMonitorStore } from '../../stores/monitor';
import { ws } from '../../api/websocket';
import { showToast } from '../ui/Toast';
import * as api from '../../api/endpoints';
import type { Backup } from '../../types';

const TABS = [
  { id: 'voice', label: 'Voice' },
  { id: 'briefing', label: 'Briefing' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'backup', label: 'Backup' },
  { id: 'monitor', label: 'Monitor' },
];

const VOICES = [
  { value: 'en-US-GuyNeural', label: 'Guy (US)' },
  { value: 'en-US-ChristopherNeural', label: 'Christopher (US)' },
  { value: 'en-US-EricNeural', label: 'Eric (US)' },
  { value: 'en-IN-PrabhatNeural', label: 'Prabhat (IN)' },
  { value: 'en-US-JennyNeural', label: 'Jenny (US)' },
  { value: 'en-US-AriaNeural', label: 'Aria (US)' },
  { value: 'en-IN-NeerjaNeural', label: 'Neerja (IN)' },
];

export default function SettingsView() {
  const [tab, setTab] = useState('voice');

  return (
    <div className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">
      <h1 className="font-mono text-xs tracking-[0.2em] uppercase text-jarvis-cyan mb-6 text-glow-cyan">
        Settings
      </h1>
      <Tabs tabs={TABS} activeTab={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'voice' && <VoiceSettings />}
        {tab === 'briefing' && <BriefingSettings />}
        {tab === 'privacy' && <PrivacySettings />}
        {tab === 'backup' && <BackupSettings />}
        {tab === 'monitor' && <MonitorSettings />}
      </div>
    </div>
  );
}

function VoiceSettings() {
  const selectedVoice = useChatStore((s) => s.selectedVoice);
  const setSelectedVoice = useChatStore((s) => s.setSelectedVoice);
  const noiseGate = useSettingsStore((s) => s.noiseGateThreshold);
  const setNoiseGate = useSettingsStore((s) => s.setNoiseGateThreshold);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Mic size={16} className="text-jarvis-cyan" />
          <span className="font-mono text-[0.65rem] tracking-[0.1em] uppercase text-jarvis-cyan">Voice Configuration</span>
        </div>
        <Select
          label="TTS Voice"
          value={selectedVoice}
          onChange={(e) => {
            setSelectedVoice(e.target.value);
            ws.send({ type: 'set_voice', voice: e.target.value });
          }}
          options={VOICES}
        />
        <div className="mt-4">
          <label className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-jarvis-fg-dim block mb-2">
            Noise Gate Sensitivity: {(noiseGate * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min="0"
            max="0.1"
            step="0.005"
            value={noiseGate}
            onChange={(e) => setNoiseGate(parseFloat(e.target.value))}
            className="w-full accent-jarvis-cyan"
          />
          <div className="flex justify-between font-mono text-[0.5rem] text-jarvis-fg-dim mt-1">
            <span>Sensitive</span>
            <span>Aggressive</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function BriefingSettings() {
  const { briefingConfig, fetchBriefingConfig, updateBriefingConfig } = useSettingsStore();

  useEffect(() => { fetchBriefingConfig(); }, [fetchBriefingConfig]);

  if (!briefingConfig) return <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Bell size={16} className="text-jarvis-amber" />
          <span className="font-mono text-[0.65rem] tracking-[0.1em] uppercase text-jarvis-amber">Morning Briefing</span>
        </div>
        <div className="space-y-4">
          <Toggle
            enabled={briefingConfig.enabled}
            onChange={(enabled) => updateBriefingConfig({ enabled })}
            label="Enable Morning Briefing"
          />
          <Input
            label="Briefing Time"
            type="time"
            value={briefingConfig.time}
            onChange={(e) => updateBriefingConfig({ time: e.target.value })}
          />
          <Select
            label="Delivery Method"
            value={briefingConfig.delivery}
            onChange={(e) => updateBriefingConfig({ delivery: e.target.value })}
            options={[
              { value: 'push', label: 'Push Notification' },
              { value: 'sms', label: 'SMS' },
              { value: 'call', label: 'Phone Call' },
            ]}
          />
          <Button variant="secondary" size="sm" onClick={() => api.triggerBriefing().then(() => showToast('Briefing triggered!', 'success'))}>
            Trigger Now
          </Button>
        </div>
      </Card>
    </div>
  );
}

function PrivacySettings() {
  const [forgetTopic, setForgetTopic] = useState('');
  const [exporting, setExporting] = useState(false);

  const handleForget = async () => {
    if (!forgetTopic.trim()) return;
    await api.forgetTopic(forgetTopic.trim());
    showToast(`Forgot memories about "${forgetTopic}"`, 'success');
    setForgetTopic('');
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await api.getPrivacyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jarvis-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Data exported!', 'success');
    } catch {
      showToast('Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Shield size={16} className="text-jarvis-red" />
          <span className="font-mono text-[0.65rem] tracking-[0.1em] uppercase text-jarvis-red">Privacy Controls</span>
        </div>
        <div className="space-y-4">
          <div>
            <label className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-jarvis-fg-dim block mb-2">
              Forget memories about a topic
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={forgetTopic}
                onChange={(e) => setForgetTopic(e.target.value)}
                placeholder="e.g., my medical info"
                className="flex-1 bg-[rgba(0,20,40,0.3)] border border-jarvis-border rounded-sm px-3 py-2 text-jarvis-fg font-sans text-sm outline-none focus:border-jarvis-cyan-dim"
              />
              <Button variant="danger" size="sm" onClick={handleForget} disabled={!forgetTopic.trim()}>
                Forget
              </Button>
            </div>
          </div>
          <hr className="border-jarvis-border" />
          <div>
            <label className="font-mono text-[0.6rem] tracking-[0.1em] uppercase text-jarvis-fg-dim block mb-2">
              Export All Data
            </label>
            <Button variant="secondary" size="sm" onClick={handleExport} disabled={exporting}>
              {exporting ? 'Exporting...' : 'Download Data Export'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function BackupSettings() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.listBackups().then((d) => setBackups(d.backups)).catch(() => {});
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await api.createBackup();
      showToast('Backup created!', 'success');
      const d = await api.listBackups();
      setBackups(d.backups);
    } catch {
      showToast('Backup failed', 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Database size={16} className="text-jarvis-green" />
          <span className="font-mono text-[0.65rem] tracking-[0.1em] uppercase text-jarvis-green">Backups</span>
        </div>
        <div className="space-y-4">
          <Button size="sm" onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating...' : 'Create Backup Now'}
          </Button>

          <div className="font-mono text-[0.6rem] text-jarvis-fg-dim tracking-wider uppercase mt-4 mb-2">
            Recent Backups
          </div>
          {backups.length === 0 ? (
            <p className="text-sm text-jarvis-fg-dim">No backups yet</p>
          ) : (
            <div className="space-y-1.5">
              {backups.slice(0, 10).map((b) => (
                <div key={b.filename} className="flex items-center justify-between py-1.5 border-b border-jarvis-border last:border-0">
                  <span className="font-mono text-[0.65rem] text-jarvis-fg">{b.filename}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[0.55rem] text-jarvis-fg-dim">
                      {(b.size / 1024).toFixed(0)} KB
                    </span>
                    <span className="font-mono text-[0.55rem] text-jarvis-fg-dim">
                      {new Date(b.created).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function MonitorSettings() {
  const { health, fetchHealth } = useMonitorStore();

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  if (!health) return <div className="flex justify-center py-8"><Spinner /></div>;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2 mb-4">
          <Activity size={16} className="text-jarvis-green" />
          <span className="font-mono text-[0.65rem] tracking-[0.1em] uppercase text-jarvis-green">System Metrics</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <div className="font-mono text-[0.55rem] text-jarvis-fg-dim tracking-wider mb-1">STATUS</div>
            <Badge variant="green">{health.status}</Badge>
          </div>
          <div>
            <div className="font-mono text-[0.55rem] text-jarvis-fg-dim tracking-wider mb-1">UPTIME</div>
            <div className="text-lg text-jarvis-fg font-light">{health.uptime}</div>
          </div>
          <div>
            <div className="font-mono text-[0.55rem] text-jarvis-fg-dim tracking-wider mb-1">MEMORIES</div>
            <div className="text-lg text-jarvis-fg font-light">{health.totalMemories ?? 0}</div>
          </div>
          <div>
            <div className="font-mono text-[0.55rem] text-jarvis-fg-dim tracking-wider mb-1">LLM AVG</div>
            <div className="text-lg text-jarvis-fg font-light">{health.llm?.avgLatencyMs ?? 0}ms</div>
          </div>
          <div>
            <div className="font-mono text-[0.55rem] text-jarvis-fg-dim tracking-wider mb-1">LLM P95</div>
            <div className="text-lg text-jarvis-fg font-light">{health.llm?.p95LatencyMs ?? 0}ms</div>
          </div>
          <div>
            <div className="font-mono text-[0.55rem] text-jarvis-fg-dim tracking-wider mb-1">TTS AVG</div>
            <div className="text-lg text-jarvis-fg font-light">{health.tts?.avgLatencyMs ?? 0}ms</div>
          </div>
          <div>
            <div className="font-mono text-[0.55rem] text-jarvis-fg-dim tracking-wider mb-1">TTS P95</div>
            <div className="text-lg text-jarvis-fg font-light">{health.tts?.p95LatencyMs ?? 0}ms</div>
          </div>
          <div>
            <div className="font-mono text-[0.55rem] text-jarvis-fg-dim tracking-wider mb-1">LLM ERRORS</div>
            <div className="text-lg text-jarvis-fg font-light">{health.llm?.errors ?? 0}</div>
          </div>
          <div>
            <div className="font-mono text-[0.55rem] text-jarvis-fg-dim tracking-wider mb-1">ERROR RATE</div>
            <div className="text-lg text-jarvis-fg font-light">{health.llm?.errorRate ?? '0%'}</div>
          </div>
        </div>
        <div className="mt-4">
          <Button variant="secondary" size="sm" onClick={fetchHealth}>Refresh</Button>
        </div>
      </Card>
    </div>
  );
}
