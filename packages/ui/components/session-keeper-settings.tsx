'use client';

import { useState, useEffect } from 'react';
import { useJules } from '@/lib/jules/provider';
import { SessionKeeperConfig } from '@/types/jules';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Brain, Sparkles, Trash2, Settings, Loader2, Download, Users, Plus } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

// Default configuration (Duplicated to allow standalone usage)
const DEFAULT_CONFIG: SessionKeeperConfig = {
  isEnabled: false,
  autoSwitch: true,
  checkIntervalSeconds: 30,
  inactivityThresholdMinutes: 1,
  activeWorkThresholdMinutes: 30,
  messages: [
    "Great! Please keep going as you advise!",
    "Yes! Please continue to proceed as you recommend!",
    "This looks correct. Please proceed.",
    "Excellent plan. Go ahead.",
    "Looks good to me. Continue.",
  ],
  customMessages: {},
  smartPilotEnabled: false,
  supervisorProvider: 'openai',
  supervisorApiKey: '',
  supervisorModel: '',
  contextMessageCount: 20,
  supervisorMode: 'single',
  debateEnabled: false,
  debateParticipants: []
};

interface SessionKeeperSettingsProps {
  config: SessionKeeperConfig;
  onConfigChange: (config: SessionKeeperConfig) => void;
  sessions: { id: string; title: string }[];
  onClearMemory: (sessionId: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
}

export function SessionKeeperSettings({
  config: propConfig,
  onConfigChange: propOnChange,
  sessions: propSessions,
  onClearMemory: propOnClearMemory,
  open: propOpen,
  onOpenChange: propOnOpenChange,
  trigger
}: Partial<SessionKeeperSettingsProps>) {
  const { apiKey: mainApiKey } = useJules();
  const [isOpen, setIsOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<SessionKeeperConfig>(DEFAULT_CONFIG);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('global');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  // Use props if available (controlled), otherwise local (uncontrolled)
  const config = propConfig || localConfig;
  const sessions = propSessions || []; // Fallback to empty if not provided in standalone mode
  
  // Handle controlled open state
  const isDialogOpen = propOpen !== undefined ? propOpen : isOpen;
  const handleOpenChange = propOnOpenChange || setIsOpen;

  // Sync from storage if standalone
  useEffect(() => {
      if (!propConfig) {
          const stored = localStorage.getItem('jules-session-keeper-config');
          if (stored) {
              try { setLocalConfig({ ...DEFAULT_CONFIG, ...JSON.parse(stored) }); }
              catch(e) { console.error(e); }
          }
      }
  }, [propConfig]);

  const handleConfigChange = (newConfig: SessionKeeperConfig) => {
      if (propOnChange) {
          propOnChange(newConfig);
      } else {
          setLocalConfig(newConfig);
          localStorage.setItem('jules-session-keeper-config', JSON.stringify(newConfig));
          window.dispatchEvent(new Event('jules-config-updated'));
      }
  };

  const handleClearMemory = (sessionId: string) => {
      if (propOnClearMemory) {
          propOnClearMemory(sessionId);
      } else {
          const savedState = localStorage.getItem('jules_supervisor_state');
          if (savedState) {
              const state = JSON.parse(savedState);
              if (state[sessionId]) {
                  delete state[sessionId];
                  localStorage.setItem('jules_supervisor_state', JSON.stringify(state));
              }
          }
      }
  };

  // New Participant State
  const [newPart, setNewPart] = useState({ provider: 'openai', model: 'gpt-4o', apiKey: '', role: 'Advisor' });

  const updateMessages = (sessionId: string, newMessages: string[]) => {
    if (sessionId === 'global') {
      handleConfigChange({ ...config, messages: newMessages });
    } else {
      handleConfigChange({
        ...config,
        customMessages: {
          ...config.customMessages,
          [sessionId]: newMessages
        }
      });
    }
  };

  const handleLoadModels = async (provider?: string, apiKey?: string) => {
    const p = provider || config.supervisorProvider;
    const k = apiKey || config.supervisorApiKey;
    if (!k || !p) return;

    setLoadingModels(true);
    try {
      const response = await fetch('/api/supervisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'list_models',
          provider: p,
          apiKey: k
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.models && Array.isArray(data.models)) {
          setAvailableModels(data.models);
          if (!provider) { // Main Supervisor
             if (!config.supervisorModel && data.models.length > 0) {
               handleConfigChange({ ...config, supervisorModel: data.models[0] });
             }
          }
        }
      }
    } catch (err) {
      console.error('Failed to load models', err);
    } finally {
      setLoadingModels(false);
    }
  };

  const addParticipant = () => {
      const participants = config.debateParticipants || [];
      handleConfigChange({
          ...config,
          debateParticipants: [
              ...participants,
              { ...newPart, id: crypto.randomUUID() }
          ]
      });
      setNewPart({ provider: 'openai', model: '', apiKey: '', role: 'Advisor' });
  };

  const removeParticipant = (index: number) => {
      const participants = config.debateParticipants || [];
      handleConfigChange({
          ...config,
          debateParticipants: participants.filter((_, i) => i !== index)
      });
  };

  const currentMessages = selectedSessionId === 'global'
    ? config.messages
    : (config.customMessages?.[selectedSessionId] || []);

  return (
    <Dialog open={isDialogOpen} onOpenChange={handleOpenChange}>
      {trigger !== null && (
        <DialogTrigger asChild>
          {trigger || (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/10" title="Auto-Pilot Settings">
              <Settings className="h-4 w-4" />
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-w-2xl bg-zinc-950 border-white/10 text-white max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b border-white/10">
          <DialogTitle className="text-lg font-bold tracking-wide">Auto-Pilot Configuration</DialogTitle>
          <DialogDescription className="text-white/40 text-xs">
            Configure how Jules monitors and interacts with your sessions.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 py-4">
          <div className="space-y-6">
            {/* Main Controls */}
            <div className="flex flex-col gap-4 border border-white/10 p-4 rounded-lg bg-white/5">
              <div className="flex items-center justify-between">
                <Label htmlFor="keeper-enabled" className="flex flex-col gap-1">
                  <span className="font-semibold text-sm">Enable Auto-Pilot</span>
                  <span className="font-normal text-xs text-white/40">
                    Continuously monitor active sessions
                  </span>
                </Label>
                <Switch
                  id="keeper-enabled"
                  checked={config.isEnabled}
                  onCheckedChange={(c) => handleConfigChange({ ...config, isEnabled: c })}
                />
              </div>
              <Separator className="bg-white/10" />
              <div className="flex items-center justify-between">
                <Label htmlFor="auto-switch" className="flex flex-col gap-1">
                  <span className="font-semibold text-sm">Auto-Switch Session</span>
                  <span className="font-normal text-xs text-white/40">
                    Navigate to the session being acted upon
                  </span>
                </Label>
                <Switch
                  id="auto-switch"
                  checked={config.autoSwitch}
                  onCheckedChange={(c) => handleConfigChange({ ...config, autoSwitch: c })}
                />
              </div>
            </div>

            {/* Smart Supervisor Settings */}
            <div className="flex flex-col gap-4 border border-purple-500/20 p-4 rounded-lg bg-purple-500/5">
              <div className="flex items-center justify-between">
                <Label htmlFor="smart-pilot" className="flex flex-col gap-1">
                  <span className="font-semibold text-sm flex items-center gap-2 text-purple-400">
                    <Sparkles className="h-4 w-4" />
                    Smart Supervisor
                  </span>
                  <span className="font-normal text-xs text-white/40">
                    Use AI to generate context-aware guidance
                  </span>
                </Label>
                <Switch
                  id="smart-pilot"
                  checked={config.smartPilotEnabled}
                  onCheckedChange={(c) => handleConfigChange({ ...config, smartPilotEnabled: c })}
                />
              </div>

              {config.smartPilotEnabled && (
                <div className="grid gap-4 pt-2">
                  <div className="space-y-2">
                    <Label className="text-xs text-white/60">Mode</Label>
                    <Select
                      value={config.supervisorMode || (config.debateEnabled ? 'debate' : 'single')}
                      onValueChange={(v: any) => handleConfigChange({ ...config, supervisorMode: v, debateEnabled: v !== 'single' })}
                    >
                      <SelectTrigger className="h-8 text-xs bg-black/50 border-white/10"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-white/10 text-white">
                        <SelectItem value="single">Single Supervisor</SelectItem>
                        <SelectItem value="debate">Debate (Consensus)</SelectItem>
                        <SelectItem value="conference">Smart Conference (Round Table)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {config.supervisorMode === 'single' || !config.supervisorMode ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs text-white/60">Provider</Label>
                      <Select
                        value={config.supervisorProvider}
                        onValueChange={(v: any) => {
                          handleConfigChange({ ...config, supervisorProvider: v, supervisorModel: '' });
                          setAvailableModels([]);
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs bg-black/50 border-white/10"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-white/10 text-white">
                          <SelectItem value="openai">OpenAI (Chat Completions)</SelectItem>
                          <SelectItem value="openai-assistants">OpenAI (Assistants API)</SelectItem>
                          <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                          <SelectItem value="gemini">Google (Gemini)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-white/60">API Key</Label>
                      <div className="flex gap-2">
                        <Input
                          className="h-8 text-xs bg-black/50 border-white/10 font-mono flex-1"
                          type="password"
                          placeholder={`Enter ${config.supervisorProvider} API Key`}
                          value={config.supervisorApiKey}
                          onChange={(e) => handleConfigChange({ ...config, supervisorApiKey: e.target.value })}
                        />
                        {mainApiKey && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 border-white/10 hover:bg-white/5 text-white/60 text-[10px]"
                            onClick={() => handleConfigChange({ ...config, supervisorApiKey: mainApiKey })}
                            title="Use Main Session API Key"
                          >
                            Use Main Key
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                  ) : null}

                  {(config.supervisorMode === 'single' || !config.supervisorMode) && (
                  <div className="space-y-2">
                    <Label className="text-xs text-white/60">Model</Label>
                    <div className="flex gap-2">
                      {availableModels.length > 0 ? (
                        <Select
                          value={config.supervisorModel}
                          onValueChange={(v) => handleConfigChange({ ...config, supervisorModel: v })}
                        >
                          <SelectTrigger className="h-8 text-xs bg-black/50 border-white/10 flex-1"><SelectValue placeholder="Select Model" /></SelectTrigger>
                          <SelectContent className="bg-zinc-900 border-white/10 text-white max-h-[200px]">
                            {availableModels.map(m => (
                              <SelectItem key={m} value={m}>{m}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          className="h-8 text-xs bg-black/50 border-white/10 flex-1"
                          placeholder="e.g. gpt-4o"
                          value={config.supervisorModel}
                          onChange={(e) => handleConfigChange({ ...config, supervisorModel: e.target.value })}
                        />
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 border-white/10 hover:bg-white/5 text-white/60"
                        onClick={() => handleLoadModels()}
                        disabled={!config.supervisorApiKey || loadingModels}
                        title="Load Models from Provider"
                      >
                        {loadingModels ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                      </Button>
                    </div>
                  </div>
                  )}

                  {/* Conference / Debate Participants */}
                  {(config.supervisorMode === 'debate' || config.supervisorMode === 'conference') && (
                      <div className="space-y-3 border border-white/10 p-3 rounded bg-white/5">
                          <div className="flex items-center justify-between">
                              <Label className="text-xs font-bold text-white/80">
                                  {config.supervisorMode === 'debate' ? 'Council Members' : 'Conference Participants'}
                              </Label>
                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={addParticipant}>
                                  <Plus className="h-4 w-4" />
                              </Button>
                          </div>
                          
                          <div className="space-y-2">
                              {(config.debateParticipants || []).map((p, i) => (
                                  <div key={p.id || i} className="flex flex-col gap-2 p-2 bg-black/30 rounded border border-white/5">
                                      <div className="flex gap-2">
                                          <Select value={p.provider} onValueChange={(v) => {
                                              const newParts = [...(config.debateParticipants || [])];
                                              newParts[i] = { ...p, provider: v };
                                              handleConfigChange({ ...config, debateParticipants: newParts });
                                          }}>
                                              <SelectTrigger className="h-6 text-[10px] w-24"><SelectValue /></SelectTrigger>
                                              <SelectContent>
                                                  <SelectItem value="openai">OpenAI</SelectItem>
                                                  <SelectItem value="anthropic">Anthropic</SelectItem>
                                                  <SelectItem value="gemini">Gemini</SelectItem>
                                              </SelectContent>
                                          </Select>
                                          <Input 
                                              className="h-6 text-[10px] flex-1" 
                                              placeholder="Model (e.g. gpt-4o)" 
                                              value={p.model}
                                              onChange={(e) => {
                                                  const newParts = [...(config.debateParticipants || [])];
                                                  newParts[i] = { ...p, model: e.target.value };
                                                  handleConfigChange({ ...config, debateParticipants: newParts });
                                              }}
                                          />
                                          <Button variant="ghost" size="icon" className="h-6 w-6 text-red-400" onClick={() => removeParticipant(i)}>
                                              <Trash2 className="h-3 w-3" />
                                          </Button>
                                      </div>
                                      <div className="flex gap-2">
                                          <Input 
                                              className="h-6 text-[10px] flex-1" 
                                              placeholder="Role (e.g. Security Expert)" 
                                              value={p.role}
                                              onChange={(e) => {
                                                  const newParts = [...(config.debateParticipants || [])];
                                                  newParts[i] = { ...p, role: e.target.value };
                                                  handleConfigChange({ ...config, debateParticipants: newParts });
                                              }}
                                          />
                                          <Input 
                                              className="h-6 text-[10px] flex-1 font-mono" 
                                              type="password"
                                              placeholder="API Key" 
                                              value={p.apiKey}
                                              onChange={(e) => {
                                                  const newParts = [...(config.debateParticipants || [])];
                                                  newParts[i] = { ...p, apiKey: e.target.value };
                                                  handleConfigChange({ ...config, debateParticipants: newParts });
                                              }}
                                          />
                                      </div>
                                  </div>
                              ))}
                              {(config.debateParticipants || []).length === 0 && (
                                  <div className="text-[10px] text-white/30 text-center py-2">No participants added</div>
                              )}
                          </div>
                      </div>
                  )}

                  <div className="space-y-2">
                    <Label className="text-xs text-white/60">Context History (Messages)</Label>
                    <Input
                      className="h-8 text-xs bg-black/50 border-white/10"
                      type="number"
                      min={1}
                      max={50}
                      value={config.contextMessageCount}
                      onChange={(e) => handleConfigChange({ ...config, contextMessageCount: parseInt(e.target.value) || 10 })}
                    />
                  </div>

                  <div className="pt-2 border-t border-white/5 mt-2">
                     <Label className="mb-2 block text-xs text-white/60">Memory Management</Label>
                     <div className="flex items-center gap-2">
                        <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
                          <SelectTrigger className="w-[180px] h-8 text-xs bg-black/50 border-white/10">
                            <SelectValue placeholder="Select context" />
                          </SelectTrigger>
                          <SelectContent className="bg-zinc-900 border-white/10 text-white">
                            <SelectItem value="global">Global Defaults</SelectItem>
                            {sessions.map(s => (
                              <SelectItem key={s.id} value={s.id}>{s.title.substring(0, 20)}...</SelectItem>
                            ))}
                          </SelectContent>
                       </Select>
                       <Button
                         variant="destructive"
                         size="sm"
                         className="h-8 text-xs"
                         disabled={selectedSessionId === 'global'}
                         onClick={() => handleClearMemory(selectedSessionId)}
                       >
                         <Trash2 className="h-3 w-3 mr-1" />
                         Clear Memory
                       </Button>
                     </div>
                  </div>
                </div>
              )}
            </div>

            {/* Timings */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-white/60">Check Freq (s)</Label>
                <Input
                  className="h-8 text-xs bg-black/50 border-white/10"
                  type="number"
                  min={10}
                  value={config.checkIntervalSeconds}
                  onChange={(e) => handleConfigChange({ ...config, checkIntervalSeconds: parseInt(e.target.value) || 30 })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-white/60">Idle Threshold (m)</Label>
                <Input
                  className="h-8 text-xs bg-black/50 border-white/10"
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={config.inactivityThresholdMinutes}
                  onChange={(e) => handleConfigChange({ ...config, inactivityThresholdMinutes: parseFloat(e.target.value) || 1 })}
                />
              </div>
            </div>

            <div className="space-y-2 border border-white/10 p-4 rounded-lg bg-white/5">
              <div className="flex justify-between items-center">
                <Label className="text-xs text-white/60">Working Threshold (m)</Label>
                <Input
                  className="w-16 h-8 text-xs bg-black/50 border-white/10"
                  type="number"
                  min={1}
                  value={config.activeWorkThresholdMinutes}
                  onChange={(e) => handleConfigChange({ ...config, activeWorkThresholdMinutes: parseFloat(e.target.value) || 30 })}
                />
              </div>
              <p className="text-[9px] text-white/30">
                Wait time for sessions marked &quot;In Progress&quot; before interrupting.
              </p>
            </div>

            {/* Fallback Messages */}
            <div className="space-y-4">
               <div className="flex justify-between items-center">
                 <Label className="text-xs text-white/60">
                   {config.smartPilotEnabled ? 'Fallback Messages' : 'Encouragement Messages'}
                 </Label>
                 {!config.smartPilotEnabled && (
                   <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
                      <SelectTrigger className="w-[140px] h-8 text-xs bg-black/50 border-white/10">
                        <SelectValue placeholder="Select context" />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-white/10 text-white">
                        <SelectItem value="global">Global Defaults</SelectItem>
                        {sessions.map(s => (
                          <SelectItem key={s.id} value={s.id}>{s.title.substring(0, 20)}...</SelectItem>
                        ))}
                      </SelectContent>
                   </Select>
                 )}
               </div>

               <Textarea
                className="min-h-[100px] font-mono text-[10px] bg-black/50 border-white/10 text-white/80"
                value={currentMessages.join('\n')}
                onChange={(e) => updateMessages(selectedSessionId, e.target.value.split('\n').filter(line => line.trim() !== ''))}
                placeholder={selectedSessionId === 'global' ? "Enter one message per line..." : "Enter custom messages..."}
              />
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
