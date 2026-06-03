import { useEffect, useState } from 'react';
import {
  Cpu, Brain, Calendar, Music, Search, Cloud, Phone, Home,
  CheckCircle, Circle, ExternalLink, Key, ChevronDown, ChevronUp,
  AlertTriangle, Info, Copy, Check,
} from 'lucide-react';
import { useIntegrationsStore } from '../../stores/integrations';
import { useAppStore } from '../../stores/app';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import { showToast } from '../ui/Toast';
import * as api from '../../api/endpoints';
import { ApiError } from '../../api/client';

const ICONS: Record<string, typeof Cpu> = {
  Cpu, Brain, Calendar, Music, Search, Cloud, Phone, Home,
};

// ─── Step-by-step guides for each service ────────────────
const SERVICE_GUIDES: Record<string, { steps: string[]; link: string; linkLabel: string }> = {
  groq: {
    steps: [
      'Go to console.groq.com and sign up for a free account',
      'Once logged in, click on "API Keys" in the left sidebar',
      'Click "Create API Key" and give it a name (e.g., "JARVIS")',
      'Copy the key that starts with "gsk_..." and paste it below',
    ],
    link: 'https://console.groq.com/keys',
    linkLabel: 'Open Groq Console',
  },
  anthropic: {
    steps: [
      'Go to console.anthropic.com and create an account',
      'Navigate to Settings → API Keys',
      'Click "Create Key" and give it a name',
      'Copy the key that starts with "sk-ant-..." and paste it below',
    ],
    link: 'https://console.anthropic.com/settings/keys',
    linkLabel: 'Open Anthropic Console',
  },
  google: {
    steps: [
      'Go to the Google Cloud Console (console.cloud.google.com)',
      'Create a new project or select an existing one',
      'Enable the "Google Calendar API" and "Gmail API" from the API Library',
      'Go to Credentials → Create Credentials → OAuth 2.0 Client ID',
      'Set Application Type to "Web application"',
      'Add http://localhost:3000/api/google/callback as an Authorized Redirect URI',
      'Copy the Client ID and Client Secret and paste them below',
      'After saving, click "Sign in with Google" to authorize access',
    ],
    link: 'https://console.cloud.google.com/apis/credentials',
    linkLabel: 'Open Google Cloud Console',
  },
  spotify: {
    steps: [
      'Go to the Spotify Developer Dashboard (developer.spotify.com)',
      'Log in and click "Create App"',
      'Set the app name to "JARVIS" and add a description',
      'Add http://localhost:3000/api/spotify/callback as a Redirect URI',
      'Copy the Client ID and Client Secret from the app settings',
      'After saving, click "Connect Spotify" to authorize access',
    ],
    link: 'https://developer.spotify.com/dashboard',
    linkLabel: 'Open Spotify Dashboard',
  },
  brave: {
    steps: [
      'Go to brave.com/search/api and sign up for the free plan',
      'The free plan gives you 2,000 queries/month',
      'Copy your API key from the dashboard and paste it below',
    ],
    link: 'https://brave.com/search/api/',
    linkLabel: 'Get Brave Search API Key',
  },
  openweather: {
    steps: [
      'Go to openweathermap.org and create a free account',
      'Navigate to "API Keys" in your account settings',
      'Copy the default API key or generate a new one',
      'Note: New keys may take up to 2 hours to activate',
    ],
    link: 'https://home.openweathermap.org/api_keys',
    linkLabel: 'Open OpenWeather Dashboard',
  },
  twilio: {
    steps: [
      'Go to twilio.com and create an account (free trial available)',
      'From the Console Dashboard, copy your Account SID and Auth Token',
      'Get a phone number: Go to Phone Numbers → Manage → Buy a number',
      'Enter all three values below',
    ],
    link: 'https://console.twilio.com/',
    linkLabel: 'Open Twilio Console',
  },
  homeassistant: {
    steps: [
      'Open your Home Assistant instance (usually http://homeassistant.local:8123)',
      'Go to your Profile (click your name in the bottom-left)',
      'Scroll down to "Long-Lived Access Tokens"',
      'Create a new token and copy it',
      'Enter your Home Assistant URL (e.g., http://192.168.1.x:8123) and the token below',
    ],
    link: '',
    linkLabel: '',
  },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="inline-flex items-center gap-1 text-[0.6rem] text-jarvis-fg-dim hover:text-jarvis-cyan transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

export default function IntegrationsView() {
  const { services, setServiceStatus } = useIntegrationsStore();
  const setCalendarConnected = useAppStore((s) => s.setCalendarConnected);
  const [configModal, setConfigModal] = useState<string | null>(null);
  const [keyValues, setKeyValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedGuide, setExpandedGuide] = useState<string | null>(null);
  const [oauthPolling, setOauthPolling] = useState<string | null>(null);

  const refreshStatuses = async () => {
    try {
      const config = await api.getAdminConfig();
      const knownKeys = ['groq', 'anthropic', 'google', 'spotify', 'brave', 'openweather', 'twilio', 'homeassistant'];
      Object.entries(config).forEach(([key, val]) => {
        if (knownKeys.includes(key)) {
          setServiceStatus(key, val.configured, val.connected ?? val.configured);
        }
      });
      if (config.google?.connected) setCalendarConnected(true);
    } catch {
      api.getGoogleStatus().then((d) => { setServiceStatus('google', d.connected, d.connected); if (d.connected) setCalendarConnected(true); }).catch(() => {});
      api.getSpotifyStatus().then((d) => setServiceStatus('spotify', d.authenticated, d.authenticated)).catch(() => {});
      api.getSmartHomeStatus().then((d) => setServiceStatus('homeassistant', d.connected, d.connected)).catch(() => {});
    }
  };

  useEffect(() => {
    refreshStatuses();
  }, []);

  const openConfig = (key: string) => {
    const service = services[key];
    const initialKeys: Record<string, string> = {};
    service.keys?.forEach((k) => { initialKeys[k] = ''; });
    setKeyValues(initialKeys);
    setError(null);
    setExpandedGuide(key);
    setConfigModal(key);
  };

  const handleOAuth = (key: string) => {
    const service = services[key];
    if (!service.authUrl) return;

    setOauthPolling(key);

    // Detect popup blocked
    const popup = window.open(service.authUrl, `jarvis-${key}-auth`, 'width=600,height=700,noopener');
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      setOauthPolling(null);
      showToast('Popup was blocked. Allow popups for this site and try again.', 'error');
      return;
    }

    const interval = setInterval(async () => {
      if (popup.closed) {
        clearInterval(interval);
        setOauthPolling(null);

        // Wait a moment for server to process the callback
        await new Promise((r) => setTimeout(r, 500));

        if (service.statusUrl) {
          try {
            const res = await fetch(service.statusUrl);
            const data = await res.json();
            const connected = data.connected || data.authenticated || false;
            setServiceStatus(key, true, connected);
            if (connected) {
              showToast(`${service.name} connected successfully!`, 'success');
              // Sync global calendar state
              if (key === 'google') setCalendarConnected(true);
              // Refresh all statuses
              await refreshStatuses();
            } else {
              showToast(`${service.name} not authorized — please try again.`, 'warning');
            }
          } catch {
            showToast('Could not verify connection status. Try refreshing.', 'error');
          }
        }
      }
    }, 800);
  };

  const handleSubmitKeys = async () => {
    if (!configModal) return;
    setSubmitting(true);
    setError(null);

    try {
      await api.setAdminConfig(configModal, keyValues);
      const isOAuth = services[configModal].type === 'oauth';
      // OAuth services need a separate sign-in step — mark configured but not connected yet
      setServiceStatus(configModal, true, !isOAuth);
      if (isOAuth) {
        showToast(`${services[configModal].name} credentials saved! Now click "Sign in" to authorize.`, 'success');
      } else {
        showToast(`${services[configModal].name} connected successfully!`, 'success');
      }
      setConfigModal(null);
    } catch (e) {
      const msg = e instanceof ApiError
        ? e.message
        : (e instanceof Error ? e.message : 'Validation failed — please check your keys');
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const renderOAuthSection = (key: string, service: typeof services[string]) => {
    if (service.connected) {
      return (
        <div className="flex items-center gap-2">
          <Badge variant="green">Active</Badge>
          <span className="text-[0.65rem] text-jarvis-fg-dim">Connected and working</span>
        </div>
      );
    }

    if (service.configured && service.type === 'oauth') {
      return (
        <div className="space-y-2">
          <Button size="sm" onClick={() => handleOAuth(key)} disabled={oauthPolling === key}>
            <span className="flex items-center gap-1.5">
              <ExternalLink size={12} />
              {oauthPolling === key ? 'Waiting for authorization...' : `Sign in with ${service.name.split(' ')[0]}`}
            </span>
          </Button>
          {oauthPolling === key && (
            <p className="text-[0.65rem] text-jarvis-amber animate-pulse">
              A popup window should have opened. Complete the sign-in there, then come back here.
            </p>
          )}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 pb-20 md:pb-6">
      <h1 className="font-mono text-xs tracking-[0.2em] uppercase text-jarvis-cyan mb-2 text-glow-cyan">
        Integrations
      </h1>
      <p className="text-[0.8rem] text-jarvis-fg/50 mb-6">
        Connect external services to unlock JARVIS features. Each card includes setup instructions.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(services).map(([key, service]) => {
          const Icon = ICONS[service.icon] || Cpu;
          const guide = SERVICE_GUIDES[key];

          return (
            <Card key={key} className="flex flex-col">
              {/* Header */}
              <div className="flex items-start gap-3 mb-3">
                <div className={`p-2 rounded-sm border ${
                  service.connected
                    ? 'bg-jarvis-green/10 border-jarvis-green/30'
                    : 'bg-jarvis-cyan-glow border-jarvis-border'
                }`}>
                  <Icon size={20} className={service.connected ? 'text-jarvis-green' : 'text-jarvis-cyan'} />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-jarvis-fg">{service.name}</h3>
                  <div className="flex items-center gap-1.5 mt-1">
                    {service.connected ? (
                      <>
                        <CheckCircle size={12} className="text-jarvis-green" />
                        <span className="font-mono text-[0.6rem] text-jarvis-green">Connected</span>
                      </>
                    ) : service.configured ? (
                      <>
                        <Circle size={12} className="text-jarvis-amber" />
                        <span className="font-mono text-[0.6rem] text-jarvis-amber">Keys saved — needs authorization</span>
                      </>
                    ) : (
                      <>
                        <Circle size={12} className="text-jarvis-fg-dim" />
                        <span className="font-mono text-[0.6rem] text-jarvis-fg-dim">Not configured</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-[0.75rem] text-jarvis-fg/60 mb-4">{service.description}</p>

              {/* OAuth connect button (for services that have keys saved) */}
              {renderOAuthSection(key, service)}

              {/* Configure / Reconfigure buttons */}
              <div className="mt-auto pt-2 flex gap-2 flex-wrap">
                {!service.configured && (
                  <Button size="sm" onClick={() => openConfig(key)}>
                    <span className="flex items-center gap-1.5">
                      <Key size={12} />
                      {service.type === 'oauth' ? `Setup ${service.name.split('&')[0].trim()}` : 'Configure'}
                    </span>
                  </Button>
                )}
                {service.configured && !service.connected && service.type !== 'oauth' && (
                  <Button size="sm" variant="secondary" onClick={() => openConfig(key)}>
                    <span className="flex items-center gap-1.5"><Key size={12} /> Reconfigure</span>
                  </Button>
                )}
                {service.connected && (
                  <Button size="sm" variant="secondary" onClick={() => openConfig(key)}>
                    <span className="flex items-center gap-1.5"><Key size={12} /> Reconfigure</span>
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* ─── Configuration Modal with Step-by-Step Guide ──── */}
      <Modal
        open={!!configModal}
        onClose={() => { setConfigModal(null); setError(null); }}
        title={configModal ? `Setup ${services[configModal]?.name}` : ''}
        maxWidth="max-w-xl"
      >
        {configModal && services[configModal] && (() => {
          const guide = SERVICE_GUIDES[configModal];
          const service = services[configModal];

          return (
            <div className="space-y-5">
              {/* Step-by-step guide */}
              {guide && (
                <div className="border border-jarvis-border rounded-sm overflow-hidden">
                  <button
                    onClick={() => setExpandedGuide(expandedGuide === configModal ? null : configModal)}
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-[rgba(0,180,216,0.05)] hover:bg-[rgba(0,180,216,0.08)] transition-colors"
                  >
                    <span className="flex items-center gap-2 font-mono text-[0.7rem] tracking-wider text-jarvis-cyan">
                      <Info size={14} />
                      HOW TO GET YOUR {service.type === 'oauth' ? 'OAUTH CREDENTIALS' : 'API KEY'}
                    </span>
                    {expandedGuide === configModal ? <ChevronUp size={14} className="text-jarvis-cyan" /> : <ChevronDown size={14} className="text-jarvis-cyan" />}
                  </button>

                  {expandedGuide === configModal && (
                    <div className="px-4 py-3 space-y-3">
                      <ol className="space-y-2.5">
                        {guide.steps.map((step, i) => (
                          <li key={i} className="flex gap-3">
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-jarvis-cyan/20 border border-jarvis-cyan/30 flex items-center justify-center font-mono text-[0.55rem] text-jarvis-cyan">
                              {i + 1}
                            </span>
                            <span className="text-[0.8rem] text-jarvis-fg/80 leading-relaxed">{step}</span>
                          </li>
                        ))}
                      </ol>

                      {guide.link && (
                        <a
                          href={guide.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 text-[0.7rem] font-mono tracking-wider text-jarvis-cyan border border-jarvis-cyan-dim rounded-sm hover:bg-jarvis-cyan-glow transition-colors"
                        >
                          <ExternalLink size={12} />
                          {guide.linkLabel}
                        </a>
                      )}

                      {/* Callback URL helper for OAuth services */}
                      {service.type === 'oauth' && (
                        <div className="mt-3 p-3 bg-[rgba(0,20,40,0.4)] border border-jarvis-border rounded-sm">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-mono text-[0.6rem] text-jarvis-fg-dim tracking-wider">REDIRECT / CALLBACK URI</span>
                            <CopyButton text={`${window.location.origin}/api/${configModal === 'google' ? 'google' : 'spotify'}/callback`} />
                          </div>
                          <code className="text-[0.75rem] text-jarvis-amber break-all">
                            {window.location.origin}/api/{configModal === 'google' ? 'google' : 'spotify'}/callback
                          </code>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Key input fields */}
              <div className="space-y-3">
                {service.keys?.map((keyName) => (
                  <Input
                    key={keyName}
                    label={keyName.replace(/_/g, ' ')}
                    type="password"
                    placeholder={
                      keyName.includes('URL') ? 'https://...' :
                      keyName.includes('GROQ') ? 'gsk_...' :
                      keyName.includes('ANTHROPIC') ? 'sk-ant-...' :
                      keyName.includes('CLIENT_ID') ? 'Your Client ID' :
                      keyName.includes('CLIENT_SECRET') ? 'Your Client Secret' :
                      `Enter ${keyName.replace(/_/g, ' ').toLowerCase()}`
                    }
                    value={keyValues[keyName] || ''}
                    onChange={(e) => setKeyValues({ ...keyValues, [keyName]: e.target.value })}
                  />
                ))}
              </div>

              {/* Error display */}
              {error && (
                <div className="flex items-start gap-2 p-3 bg-jarvis-red/10 border border-jarvis-red/30 rounded-sm">
                  <AlertTriangle size={16} className="text-jarvis-red flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-mono text-[0.65rem] text-jarvis-red tracking-wider block mb-0.5">VALIDATION FAILED</span>
                    <span className="text-[0.8rem] text-jarvis-fg/80">{error}</span>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="secondary" onClick={() => { setConfigModal(null); setError(null); }}>Cancel</Button>
                <Button
                  onClick={handleSubmitKeys}
                  disabled={submitting || Object.values(keyValues).some((v) => !v.trim())}
                >
                  {submitting ? 'Validating with API...' : 'Validate & Save'}
                </Button>
              </div>

              <p className="text-[0.6rem] text-jarvis-fg-dim text-center">
                Keys are validated against the actual API before saving. Invalid keys will be rejected.
              </p>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
