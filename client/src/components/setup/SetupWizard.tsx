import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronLeft, Sparkles, Cpu, Mic, Plug, Check } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Card from '../ui/Card';
import { showToast } from '../ui/Toast';
import * as api from '../../api/endpoints';
import { useChatStore } from '../../stores/chat';
import { ws } from '../../api/websocket';

const STEPS = ['Welcome', 'LLM Provider', 'Voice', 'Integrations', 'Complete'];

export default function SetupWizard() {
  const [step, setStep] = useState(0);
  const [llmProvider, setLlmProvider] = useState('groq');
  const [apiKey, setApiKey] = useState('');
  const [voice, setVoice] = useState('en-US-GuyNeural');
  const [validating, setValidating] = useState(false);
  const [llmConfigured, setLlmConfigured] = useState(false);
  const navigate = useNavigate();
  const setSelectedVoice = useChatStore((s) => s.setSelectedVoice);

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const validateLLM = async () => {
    setValidating(true);
    try {
      const keyName = llmProvider === 'groq' ? 'GROQ_API_KEY' : 'ANTHROPIC_API_KEY';
      await api.setAdminConfig(llmProvider, { [keyName]: apiKey });
      setLlmConfigured(true);
      showToast('API key validated!', 'success');
      next();
    } catch {
      showToast('Invalid API key. Please check and try again.', 'error');
    } finally {
      setValidating(false);
    }
  };

  const finish = () => {
    // Persist the chosen voice both locally and on the server (#29/#31).
    setSelectedVoice(voice);
    ws.send({ type: 'set_voice', voice });
    navigate('/chat');
  };

  return (
    <div className="min-h-screen bg-jarvis-bg flex flex-col items-center justify-center p-6">
      {/* Progress */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full transition-colors ${
              i <= step ? 'bg-jarvis-cyan' : 'bg-jarvis-border'
            }`} />
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-px transition-colors ${
                i < step ? 'bg-jarvis-cyan' : 'bg-jarvis-border'
              }`} />
            )}
          </div>
        ))}
      </div>

      <div className="w-full max-w-lg">
        {/* Step 0: Welcome */}
        {step === 0 && (
          <div className="text-center">
            <Sparkles size={48} className="text-jarvis-cyan mx-auto mb-4" />
            <h1 className="font-mono text-2xl tracking-[0.3em] text-jarvis-cyan animate-boot-glow mb-2">
              J.A.R.V.I.S
            </h1>
            <p className="font-mono text-[0.65rem] tracking-[0.2em] text-jarvis-fg-dim uppercase mb-8">
              Just A Rather Very Intelligent System
            </p>
            <p className="text-sm text-jarvis-fg/70 mb-8 max-w-sm mx-auto leading-relaxed">
              Welcome to your personal AI assistant. Let's get you set up with a few quick steps.
            </p>
            <Button onClick={next} size="lg">
              <span className="flex items-center gap-2">Get Started <ChevronRight size={16} /></span>
            </Button>
          </div>
        )}

        {/* Step 1: LLM Provider */}
        {step === 1 && (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Cpu size={20} className="text-jarvis-cyan" />
              <h2 className="font-mono text-sm tracking-[0.15em] uppercase text-jarvis-cyan">
                LLM Provider
              </h2>
            </div>
            <p className="text-[0.8rem] text-jarvis-fg/60 mb-6">
              Choose your AI provider and enter your API key. Groq is recommended for fast, free inference.
            </p>
            <div className="space-y-4">
              <Select
                label="Provider"
                value={llmProvider}
                onChange={(e) => setLlmProvider(e.target.value)}
                options={[
                  { value: 'groq', label: 'Groq (Recommended - Fast & Free)' },
                  { value: 'anthropic', label: 'Anthropic (Claude)' },
                ]}
              />
              <Input
                label="API Key"
                type="password"
                placeholder={llmProvider === 'groq' ? 'gsk_...' : 'sk-ant-...'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-[0.65rem] text-jarvis-fg-dim">
                {llmProvider === 'groq'
                  ? 'Get a free key at console.groq.com'
                  : 'Get a key at console.anthropic.com'}
              </p>
            </div>
            <div className="flex justify-between mt-6">
              <Button variant="ghost" onClick={prev}><ChevronLeft size={16} /> Back</Button>
              <Button onClick={validateLLM} disabled={!apiKey.trim() || validating}>
                {validating ? 'Validating...' : 'Validate & Continue'}
              </Button>
            </div>
          </Card>
        )}

        {/* Step 2: Voice */}
        {step === 2 && (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Mic size={20} className="text-jarvis-purple" />
              <h2 className="font-mono text-sm tracking-[0.15em] uppercase text-jarvis-purple">
                Voice Selection
              </h2>
            </div>
            <p className="text-[0.8rem] text-jarvis-fg/60 mb-6">
              Choose a voice for JARVIS. You can change this later in settings.
            </p>
            <Select
              label="TTS Voice"
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              options={[
                { value: 'en-US-GuyNeural', label: 'Guy (US Male)' },
                { value: 'en-US-ChristopherNeural', label: 'Christopher (US Male)' },
                { value: 'en-US-EricNeural', label: 'Eric (US Male)' },
                { value: 'en-IN-PrabhatNeural', label: 'Prabhat (IN Male)' },
                { value: 'en-US-JennyNeural', label: 'Jenny (US Female)' },
                { value: 'en-US-AriaNeural', label: 'Aria (US Female)' },
                { value: 'en-IN-NeerjaNeural', label: 'Neerja (IN Female)' },
              ]}
            />
            <div className="flex justify-between mt-6">
              <Button variant="ghost" onClick={prev}><ChevronLeft size={16} /> Back</Button>
              <Button onClick={next}>Continue <ChevronRight size={16} /></Button>
            </div>
          </Card>
        )}

        {/* Step 3: Integrations */}
        {step === 3 && (
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Plug size={20} className="text-jarvis-amber" />
              <h2 className="font-mono text-sm tracking-[0.15em] uppercase text-jarvis-amber">
                Integrations (Optional)
              </h2>
            </div>
            <p className="text-[0.8rem] text-jarvis-fg/60 mb-6">
              You can connect these services now or set them up later in the Integrations page.
            </p>
            <div className="space-y-3">
              {[
                { name: 'Google Calendar & Gmail', desc: 'Calendar events, email access' },
                { name: 'Spotify', desc: 'Music playback and recommendations' },
                { name: 'Brave Search', desc: 'Web search and news' },
                { name: 'Smart Home', desc: 'Home Assistant device control' },
              ].map((svc) => (
                <div key={svc.name} className="flex items-center justify-between py-2 border-b border-jarvis-border last:border-0">
                  <div>
                    <div className="text-sm text-jarvis-fg">{svc.name}</div>
                    <div className="text-[0.7rem] text-jarvis-fg-dim">{svc.desc}</div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => navigate('/integrations')}>
                    Setup
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-6">
              <Button variant="ghost" onClick={prev}><ChevronLeft size={16} /> Back</Button>
              <Button onClick={next}>Skip for Now <ChevronRight size={16} /></Button>
            </div>
          </Card>
        )}

        {/* Step 4: Complete */}
        {step === 4 && (
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-jarvis-green/20 border border-jarvis-green flex items-center justify-center mx-auto mb-4">
              <Check size={32} className="text-jarvis-green" />
            </div>
            <h2 className="font-mono text-lg tracking-[0.2em] uppercase text-jarvis-green mb-2">
              Setup Complete
            </h2>
            <p className="text-sm text-jarvis-fg/70 mb-6 max-w-sm mx-auto">
              JARVIS is ready. You can always configure more integrations and settings from the sidebar.
            </p>
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-2 text-sm">
                <Check size={14} className="text-jarvis-green" />
                <span className="text-jarvis-fg">LLM Provider: {llmConfigured ? 'Configured' : 'Pending'}</span>
              </div>
              <div className="flex items-center justify-center gap-2 text-sm">
                <Check size={14} className="text-jarvis-green" />
                <span className="text-jarvis-fg">Voice: {voice.split('-').slice(-1)[0].replace('Neural', '')}</span>
              </div>
            </div>
            <Button onClick={finish} size="lg" className="mt-8">
              Launch JARVIS
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
