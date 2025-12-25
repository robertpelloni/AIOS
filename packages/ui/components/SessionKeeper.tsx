'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useJules } from '@/lib/jules/provider';
import { RotateCw, Brain, X, Check, Activity, Users, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getArchivedSessions } from '@/lib/archive';
import { SessionKeeperSettings } from './session-keeper-settings';
import { useSessionKeeperStore } from '@/lib/stores/session-keeper';
import { SessionKeeperConfig } from '@/types/jules';

// Persistent Supervisor State
interface SupervisorState {
  [sessionId: string]: {
    lastProcessedActivityTimestamp: string;
    history: { role: string; content: string }[];
    openaiThreadId?: string;
    openaiAssistantId?: string;
  };
}

export function SessionKeeper({ onClose }: { isSidebar?: boolean, onClose?: () => void }) {
  const { client, apiKey } = useJules();
  const router = useRouter();
  const pathname = usePathname();
  
  // Use global store
  const { 
    config, setConfig, 
    logs, addLog: addLogToStore, clearLogs,
    statusSummary, setStatusSummary,
    sessionStates, updateSessionState
  } = useSessionKeeperStore();

  const [sessions, setSessions] = useState<{ id: string; title: string }[]>([]);

  // Refs for interval and preventing race conditions
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const processingRef = useRef(false);
  const hasSwitchedRef = useRef(false);
  const nextCheckRef = useRef<number>(0);

  // Helper wrapper for addLog to match existing signature
  const addLog = (message: string, type: 'info' | 'action' | 'error' | 'skip') => {
    if (type === 'info') return;
    addLogToStore(message, type);
  };

  // Fetch sessions for the dropdown
  useEffect(() => {
    if (client) {
      client.listSessions().then(data => {
        setSessions(data.map(s => ({ id: s.id, title: s.title || s.id })));
      }).catch(e => console.error('Failed to list sessions for config', e));
    }
  }, [client]);

  // Main Loop
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!config.isEnabled || !client || !apiKey) {
      setStatusSummary({ monitoringCount: 0 });
      return;
    }

    const runLoop = async () => {
      if (processingRef.current) return;
      processingRef.current = true;
      hasSwitchedRef.current = false;

      const nextCheck = Date.now() + (config.checkIntervalSeconds * 1000);
      nextCheckRef.current = nextCheck;
      setStatusSummary({ nextCheckIn: nextCheck });

      try {
        addLog('Checking sessions...', 'info');
        const currentSessions = await client.listSessions();
        const archived = getArchivedSessions();
        const activeSessions = currentSessions.filter(s => !archived.has(s.id));

        setStatusSummary({ monitoringCount: activeSessions.length });

        // Debug Log
        console.log('[SessionKeeper] Checking sessions:', activeSessions.map(s => ({
          id: s.id,
          status: s.status,
          rawState: s.rawState,
          lastActivityAt: s.lastActivityAt
        })));

        const now = new Date();

        // Load Supervisor State
        const savedState = localStorage.getItem('jules_supervisor_state');
        const supervisorState: SupervisorState = savedState ? JSON.parse(savedState) : {};
        let stateChanged = false;

        const generateMessage = async (session: any) => {
            let messageToSend = '';

            // DEBATE MODE OR SMART PILOT
            if ((config.debateEnabled && config.debateParticipants && config.debateParticipants.length > 0) || (config.smartPilotEnabled && config.supervisorApiKey)) {
              try {
                // Fetch ALL activities
                const activities = await client.listActivities(session.id);
                
                // Update last activity snippet in store
                if (activities.length > 0) {
                  const lastActivity = activities[activities.length - 1];
                  updateSessionState(session.id, {
                    lastActivitySnippet: lastActivity.content
                  });
                }

                if (session.prompt && !activities.some(a => a.content === session.prompt)) {
                    activities.unshift({
                        id: 'initial-prompt',
                        sessionId: session.id,
                        type: 'message',
                        role: 'user',
                        content: session.prompt,
                        createdAt: session.createdAt
                    });
                }
                const sortedActivities = activities.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

                // Debate / Conference Logic
                let mode = 'single';
                let isDebateOrConference = false;

                if (config.supervisorMode) {
                    mode = config.supervisorMode;
                    isDebateOrConference = mode === 'debate' || mode === 'conference';
                } else {
                    // Fallback for legacy config
                    isDebateOrConference = !!config.debateEnabled;
                    mode = isDebateOrConference ? 'debate' : 'single';
                }

                // Double-check safeguard
                if (mode === 'single') {
                    isDebateOrConference = false;
                }

                if (isDebateOrConference && config.debateParticipants && config.debateParticipants.length > 0) {
                    addLog(`Convening ${mode === 'conference' ? 'Conference' : 'Council'} (${config.debateParticipants.length} members)...`, 'info');

                    // Prepare simple history for debate (stateless usually)
                    const history = sortedActivities.map(a => ({
                        role: a.role === 'agent' ? 'assistant' : 'user',
                        content: a.content
                    })).slice(-config.contextMessageCount);

                    const response = await fetch('/api/supervisor', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: mode,
                            messages: history,
                            participants: config.debateParticipants
                        })
                    });

                    if (response.ok) {
                        const data = await response.json();
                        messageToSend = data.content;
                        if (data.opinions) {
                            data.opinions.forEach((op: any) => {
                                addLog(`Member (${op.participant.provider}): ${op.content.substring(0, 30)}...`, 'info');
                            });
                        }
                        addLog(`${mode === 'conference' ? 'Conference' : 'Council'} Result: "${messageToSend.substring(0, 30)}..."`, 'action');
                    } else {
                        const err = await response.json().catch(() => ({}));
                        throw new Error(`${mode} failed: ${err.error || 'Unknown'}`);
                    }

                }
                // Single Supervisor Logic
                else if (config.smartPilotEnabled) {
                    addLog(`Asking Supervisor (${config.supervisorProvider})...`, 'info');

                    // State Management
                    if (!supervisorState[session.id]) {
                      supervisorState[session.id] = { lastProcessedActivityTimestamp: '', history: [] };
                    }
                    const sessionState = supervisorState[session.id];

                    // Identify NEW activities
                    let newActivities = sortedActivities;
                    if (sessionState.lastProcessedActivityTimestamp) {
                      newActivities = sortedActivities.filter(a => new Date(a.createdAt).getTime() > new Date(sessionState.lastProcessedActivityTimestamp).getTime());
                    }

                    const isStateful = config.supervisorProvider === 'openai-assistants';
                    let messagesToSend: { role: string, content: string }[] = [];

                    if (newActivities.length > 0) {
                      if (sessionState.history.length === 0 && !sessionState.openaiThreadId) {
                        const fullSummary = newActivities.map(a => `${a.role.toUpperCase()}: ${a.content}`).join('\n\n');
                        messagesToSend.push({ role: 'user', content: `Here is the full conversation history so far. Please analyze the state and provide the next instruction:\n\n${fullSummary}` });
                      } else {
                        const updates = newActivities.map(a => `${a.role.toUpperCase()}: ${a.content}`).join('\n\n');
                        messagesToSend.push({ role: 'user', content: `Here are the latest updates since your last instruction:\n\n${updates}` });
                      }
                      sessionState.lastProcessedActivityTimestamp = newActivities[newActivities.length - 1].createdAt;
                    } else if (sessionState.history.length > 0 || sessionState.openaiThreadId) {
                       messagesToSend.push({ role: 'user', content: "The agent has been inactive for a while. Please provide a nudge or follow-up instruction." });
                    }

                    if (!isStateful) {
                      messagesToSend = [...sessionState.history, ...messagesToSend].slice(-config.contextMessageCount);
                    }

                    const response = await fetch('/api/supervisor', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        messages: messagesToSend,
                        provider: config.supervisorProvider,
                        apiKey: config.supervisorApiKey,
                        model: config.supervisorModel,
                        threadId: sessionState.openaiThreadId,
                        assistantId: sessionState.openaiAssistantId
                      })
                    });

                    if (response.ok) {
                      const data = await response.json();
                      if (data.content) {
                        messageToSend = data.content;
                        addLog(`Supervisor says: "${messageToSend.substring(0, 30)}..."`, 'action');
                        if (isStateful) {
                          sessionState.openaiThreadId = data.threadId;
                          sessionState.openaiAssistantId = data.assistantId;
                          sessionState.history.push(...messagesToSend);
                          sessionState.history.push({ role: 'assistant', content: messageToSend });
                        } else {
                          sessionState.history = [...messagesToSend, { role: 'assistant', content: messageToSend }];
                        }
                        stateChanged = true;
                      }
                    } else {
                       throw new Error('Supervisor API failed');
                    }
                }
              } catch (err) {
                console.error('Supervisor/Debate Error:', err);
                addLog(`Auto-Pilot error: ${err instanceof Error ? err.message : 'Unknown'}`, 'error');
                throw err; // Re-throw to be caught by session loop
              }
            }

            // Fallback if smart pilot disabled or failed
            if (!messageToSend) {
              let messages = config.messages;
              if (config.customMessages && config.customMessages[session.id] && config.customMessages[session.id].length > 0) {
                messages = config.customMessages[session.id];
              }
              
              if (messages.length === 0) {
                // Default fallback if no messages configured
                return "Please resume working on this task.";
              }
              messageToSend = messages[Math.floor(Math.random() * messages.length)];
            }
            return messageToSend;
        };

        for (const session of activeSessions) {
          // Check if session is ignored due to error
          const sessionState = sessionStates[session.id];
          if (sessionState?.ignoreUntil && sessionState.ignoreUntil > Date.now()) {
            const remaining = Math.ceil((sessionState.ignoreUntil - Date.now()) / 60000);
            addLog(`Skipping ${session.id.substring(0, 8)} (Ignored for ${remaining}m due to error)`, 'skip');
            continue;
          }

          try {
            // Helper to switch session safely
            const safeSwitch = (targetId: string) => {
              const cleanId = targetId.replace('sessions/', '');
              const targetPath = `/?sessionId=${cleanId}`;
              if (config.autoSwitch && !hasSwitchedRef.current) {
                 router.push(targetPath);
                 hasSwitchedRef.current = true;
              }
            };

            // 1. Resume Paused/Completed/Failed
            if (session.status === 'paused' || session.status === 'completed' || session.status === 'failed') {
               addLog(`Resuming ${session.status} session ${session.id.substring(0, 8)}...`, 'action');
               safeSwitch(session.id);
               
               const message = await generateMessage(session);
               await client.resumeSession(session.id, message);
               
               addLog(`Resumed ${session.id.substring(0, 8)}`, 'action');
               setStatusSummary({ lastAction: `Resumed ${session.id.substring(0,8)}` });
               
               // Clear error if successful
               if (sessionState?.error) {
                 updateSessionState(session.id, { error: undefined, ignoreUntil: undefined });
               }
               continue;
            }

            // 2. Approve Plans
            if (session.status === 'awaiting_approval' || session.rawState === 'AWAITING_PLAN_APPROVAL') {
              addLog(`Approving plan for session ${session.id.substring(0, 8)}...`, 'action');
              safeSwitch(session.id);
              await client.approvePlan(session.id);
              addLog(`Plan approved for ${session.id.substring(0, 8)}`, 'action');
              setStatusSummary({ lastAction: `Approved Plan ${session.id.substring(0,8)}` });
              continue;
            }

            // 3. Check for Inactivity & Nudge
            const lastActivityTime = session.lastActivityAt ? new Date(session.lastActivityAt) : new Date(session.updatedAt);
            const diffMs = now.getTime() - lastActivityTime.getTime();
            const diffMinutes = diffMs / 60000;

            // Determine threshold
            let threshold = config.inactivityThresholdMinutes;
            if (session.rawState === 'IN_PROGRESS') {
               threshold = config.activeWorkThresholdMinutes;
               // Guard: If actively working (<30s), always skip
               if (diffMs < 30000) {
                 addLog(`Skipped ${session.id.substring(0, 8)}: Working (Active < 30s)`, 'skip');
                 continue;
               }
            }

            if (diffMinutes > threshold) {
              safeSwitch(session.id);
              
              const messageToSend = await generateMessage(session);
              if (!messageToSend) {
                  addLog(`Skipped ${session.id.substring(0, 8)}: No messages configured`, 'skip');
                  continue;
              }
              
              addLog(`Sending nudge to ${session.id.substring(0, 8)} (${Math.round(diffMinutes)}m inactive)`, 'action');
              await client.createActivity({
                sessionId: session.id,
                content: messageToSend,
                type: 'message'
              });
              addLog(`Nudge sent`, 'action');
              setStatusSummary({ lastAction: `Nudged ${session.id.substring(0,8)}` });
              
              // Clear error if successful
              if (sessionState?.error) {
                updateSessionState(session.id, { error: undefined, ignoreUntil: undefined });
              }
            }
          } catch (err: any) {
            console.error(`Error processing session ${session.id}:`, err);
            
            // Check for 429 or other errors
            const is429 = err?.status === 429 || 
                          err?.code === 429 || 
                          err?.message?.includes('429') || 
                          err?.message?.includes('Quota exceeded') ||
                          err?.message?.includes('RESOURCE_EXHAUSTED');

            if (is429) {
              const ignoreDuration = 5 * 60 * 1000; // 5 minutes
              addLog(`Rate limit hit for ${session.id.substring(0, 8)}. Ignoring for 5m.`, 'error');
              updateSessionState(session.id, {
                error: {
                  code: 429,
                  message: 'Rate Limit Exceeded (429)',
                  timestamp: Date.now()
                },
                ignoreUntil: Date.now() + ignoreDuration
              });
            } else {
              addLog(`Error processing ${session.id.substring(0, 8)}: ${err.message}`, 'error');
            }
          }
        }

        // Save State if changed
        if (stateChanged) {
          localStorage.setItem('jules_supervisor_state', JSON.stringify(supervisorState));
        }

      } catch (error) {
        console.error('Session Keeper Error:', error);
        addLog(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      } finally {
        processingRef.current = false;
      }
    };

    runLoop();
    intervalRef.current = setInterval(runLoop, config.checkIntervalSeconds * 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [config, client, apiKey, router, pathname, addLogToStore, setStatusSummary, updateSessionState, sessionStates]);

  const clearSupervisorMemory = (sessionId: string) => {
    const savedState = localStorage.getItem('jules_supervisor_state');
    if (savedState) {
      const state = JSON.parse(savedState);
      if (state[sessionId]) {
        delete state[sessionId];
        localStorage.setItem('jules_supervisor_state', JSON.stringify(state));
        addLog(`Cleared Supervisor memory for ${sessionId.substring(0,8)}`, 'action');
      }
    }
  };

  if (!apiKey) return null;

  return (
    <div className="h-full flex flex-col bg-zinc-950 border-l border-white/5">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-zinc-950/50">
        <div className="flex items-center gap-3">
          {config.smartPilotEnabled ? (
            <div className="relative">
               <Brain className="h-5 w-5 text-purple-500" />
               <Sparkles className="h-2 w-2 text-yellow-400 absolute -top-1 -right-1 animate-pulse" />
            </div>
          ) : (
            <RotateCw className={`h-5 w-5 ${config.isEnabled ? 'text-green-500 animate-spin-slow' : 'text-white/40'}`} />
          )}
          <div>
            <h2 className="text-sm font-bold tracking-wide uppercase text-white">Auto-Pilot</h2>
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${config.isEnabled ? 'bg-green-500' : 'bg-red-500'}`} />
              <p className="text-[10px] text-white/50 font-mono uppercase">
                {config.isEnabled ? 'Active' : 'Disabled'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
           <SessionKeeperSettings
             config={config}
             onConfigChange={setConfig}
             sessions={sessions}
             onClearMemory={clearSupervisorMemory}
           />
           {onClose && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white/40 hover:text-white" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
           )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col p-4 gap-4">
        {/* Status Cards */}
        <div className="grid grid-cols-2 gap-3">
           <Card className="bg-white/5 border-white/10 p-3 flex flex-col justify-between">
              <span className="text-[10px] uppercase text-white/40 font-bold tracking-wider">Monitored</span>
              <div className="text-2xl font-mono text-white">{statusSummary.monitoringCount}</div>
           </Card>
           <Card className="bg-white/5 border-white/10 p-3 flex flex-col justify-between">
              <span className="text-[10px] uppercase text-white/40 font-bold tracking-wider">Next Check</span>
              <div className="text-xs font-mono text-white/80 mt-1">
                 {config.isEnabled ? `${config.checkIntervalSeconds}s` : 'Paused'}
              </div>
           </Card>
        </div>

        {/* Last Action */}
        <Card className="bg-purple-500/10 border-purple-500/20 p-3">
           <div className="flex items-center gap-2 mb-1">
              <Activity className="h-3 w-3 text-purple-400" />
              <span className="text-[10px] uppercase text-purple-300 font-bold tracking-wider">Last Action</span>
           </div>
           <p className="text-xs text-purple-100 font-mono truncate">
              {statusSummary.lastAction}
           </p>
        </Card>

        {/* Live Logs */}
        <div className="flex-1 flex flex-col min-h-0 border border-white/10 rounded-lg bg-black/50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/5">
            <span className="text-[10px] uppercase text-white/40 font-bold tracking-wider">Activity Log</span>
            <Button variant="ghost" size="sm" className="h-5 text-[9px] hover:bg-white/5 text-white/40" onClick={clearLogs}>
              CLEAR
            </Button>
          </div>
          <ScrollArea className="flex-1 p-0">
            <div className="flex flex-col font-mono text-[10px]">
              {logs.length === 0 && (
                <div className="p-4 text-center text-white/20 italic">No activity recorded...</div>
              )}
              {logs.map((log, i) => (
                <div key={i} className={`flex gap-3 px-3 py-1.5 border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors ${
                  log.type === 'error' ? 'text-red-400 bg-red-950/10' :
                  log.type === 'action' ? 'text-green-400 bg-green-950/10' :
                  log.type === 'skip' ? 'text-yellow-500/50' :
                  'text-white/40'
                }`}>
                  <span className="opacity-40 shrink-0 w-14">{log.time}</span>
                  <span className="break-all">{log.message}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
