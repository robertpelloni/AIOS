'use client';

import { useEffect, useRef } from 'react';
import { useJules } from '@/lib/jules/provider';
import { useSessionKeeperStore } from '@/lib/stores/session-keeper';

// Persistent Supervisor State
interface SupervisorState {
  [sessionId: string]: {
    lastProcessedActivityTimestamp: string;
    history: { role: string; content: string }[];
    openaiThreadId?: string;
    openaiAssistantId?: string;
  };
}

export function SessionKeeperManager() {
  const { client, apiKey } = useJules();
  const { config, addLog, setStatusSummary, updateSessionState } = useSessionKeeperStore();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const processingRef = useRef(false);

  // Sync with Server Supervisor
  useEffect(() => {
    if (apiKey && config.isEnabled) {
      fetch('/api/supervisor/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          apiKey,
          config: {
            checkIntervalSeconds: config.checkIntervalSeconds,
            inactivityThresholdMinutes: config.inactivityThresholdMinutes,
            activeWorkThresholdMinutes: config.activeWorkThresholdMinutes,
            messages: config.messages
          }
        })
      }).catch(err => console.error('Failed to sync supervisor to server:', err));
    } else {
      // Disable server supervisor if client disables it
      fetch('/api/supervisor/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false })
      }).catch(() => {});
    }
  }, [apiKey, config.isEnabled, config.checkIntervalSeconds, config.inactivityThresholdMinutes, config.activeWorkThresholdMinutes, config.messages]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!config.isEnabled || !client) {
      setStatusSummary({
        monitoringCount: 0,
        lastAction: 'Disabled',
        nextCheckIn: 0
      });
      return;
    }

    const runLoop = async () => {
      if (processingRef.current) return;
      processingRef.current = true;

      try {
        const sessions = await client.listSessions();
        // Filter out archived if we had a way to check, for now assume all returned are relevant
        const monitoredSessions = sessions;

        setStatusSummary({
          monitoringCount: monitoredSessions.length,
          lastAction: 'Checked ' + new Date().toLocaleTimeString(),
          nextCheckIn: Date.now() + (config.checkIntervalSeconds * 1000)
        });

        // Load Supervisor State
        const savedState = localStorage.getItem('jules_supervisor_state');
        const supervisorState: SupervisorState = savedState ? JSON.parse(savedState) : {};
        let stateChanged = false;

        // Debug Config
        console.log('[Auto-Pilot Debug] Config:', {
            mode: config.supervisorMode,
            debateEnabled: config.debateEnabled,
            smartPilot: config.smartPilotEnabled,
            participants: config.debateParticipants?.length
        });

        const generateMessage = async (session: any) => {
            let messageToSend = '';

            // DEBATE MODE OR SMART PILOT
            if ((config.debateEnabled && config.debateParticipants && config.debateParticipants.length > 0) || (config.smartPilotEnabled && config.supervisorApiKey)) {
              try {
                // Fetch ALL activities
                const activities = await client.listActivities(session.id);
                if (session.prompt && !activities.some((a: any) => a.content === session.prompt)) {
                    activities.unshift({
                        id: 'initial-prompt',
                        sessionId: session.id,
                        type: 'message',
                        role: 'user',
                        content: session.prompt,
                        createdAt: session.createdAt
                    } as any);
                }
                const sortedActivities = activities.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

                // Debate / Conference Logic
                // Strictly check supervisorMode to prevent accidental debate execution
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
                    // Validate participants have API keys
                    const validParticipants = config.debateParticipants.filter(p => p.apiKey && p.apiKey.trim().length > 0);
                    
                    if (validParticipants.length === 0) {
                        throw new Error(`No valid participants for ${mode}. Please check API keys in Session Keeper settings.`);
                    }

                    addLog(`Convening ${mode === 'conference' ? 'Conference' : 'Council'} (${validParticipants.length} members)...`, 'info');

                    // Prepare simple history for debate (stateless usually)
                    const history = sortedActivities.map((a: any) => ({
                        role: a.role === 'agent' ? 'assistant' : 'user',
                        content: a.content
                    })).slice(-config.contextMessageCount);

                    const response = await fetch('/api/supervisor', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: mode,
                            messages: history,
                            participants: validParticipants
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
                      newActivities = sortedActivities.filter((a: any) => new Date(a.createdAt).getTime() > new Date(sessionState.lastProcessedActivityTimestamp).getTime());
                    }

                    const isStateful = config.supervisorProvider === 'openai-assistants';
                    let messagesToSend: { role: string, content: string }[] = [];

                    if (newActivities.length > 0) {
                      if (sessionState.history.length === 0 && !sessionState.openaiThreadId) {
                        const fullSummary = newActivities.map((a: any) => `${a.role.toUpperCase()}: ${a.content}`).join('\n\n');
                        messagesToSend.push({ role: 'user', content: `Here is the full conversation history so far. Please analyze the state and provide the next instruction:\n\n${fullSummary}` });
                      } else {
                        const updates = newActivities.map((a: any) => `${a.role.toUpperCase()}: ${a.content}`).join('\n\n');
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
              }
            }

            // Fallback if smart pilot disabled or failed
            if (!messageToSend) {
              let messages = config.messages;
              if (config.customMessages && config.customMessages[session.id] && config.customMessages[session.id].length > 0) {
                messages = config.customMessages[session.id];
              }
              
              if (messages.length === 0) {
                return "Please resume working on this task.";
              }
              messageToSend = messages[Math.floor(Math.random() * messages.length)];
            }
            return messageToSend;
        };

        for (const session of monitoredSessions) {
          try {
            // Clear previous error if any
            updateSessionState(session.id, { error: undefined });

            // 1. Resume Paused/Completed/Failed
            if (session.status === 'paused' || session.status === 'completed' || session.status === 'failed') {
               addLog(`Resuming ${session.status} session ${session.id.substring(0, 8)}...`, 'action');
               
               const message = await generateMessage(session);
               await client.resumeSession(session.id, message);
               
               addLog(`Resumed ${session.id.substring(0, 8)}`, 'action');
               continue;
            }

            // 2. Approve Plans
            if (session.status === 'awaiting_approval' || session.rawState === 'AWAITING_PLAN_APPROVAL') {
              addLog(`Approving plan for session ${session.id.substring(0, 8)}...`, 'action');
              await client.approvePlan(session.id);
              addLog(`Plan approved for ${session.id.substring(0, 8)}`, 'action');
              continue;
            }

            // 3. Check for Inactivity & Nudge
            const lastActivityTime = session.lastActivityAt ? new Date(session.lastActivityAt) : new Date(session.updatedAt);
            const diffMs = Date.now() - lastActivityTime.getTime();
            const diffMinutes = diffMs / 60000;

            // Determine threshold
            let threshold = config.inactivityThresholdMinutes;
            if (session.rawState === 'IN_PROGRESS') {
               threshold = config.activeWorkThresholdMinutes;
               // Guard: If actively working (<30s), always skip
               if (diffMs < 30000) {
                 continue;
               }
            }

            if (diffMinutes > threshold) {
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
            }
          } catch (err: any) {
            const isRateLimit = err.message?.includes('429') || err.status === 429;
            const errorMsg = isRateLimit ? 'Rate Limit (429)' : (err.message || 'Unknown error');
            
            addLog(`Error processing ${session.id.substring(0, 8)}: ${errorMsg}`, 'error');
            
            updateSessionState(session.id, { 
              error: { 
                code: isRateLimit ? 429 : 500, 
                message: errorMsg, 
                timestamp: Date.now() 
              } 
            });
          }
          // Add a delay to prevent rate limiting (increased to 3s)
          await new Promise(resolve => setTimeout(resolve, 3000));
        }

        // Save State if changed
        if (stateChanged) {
          localStorage.setItem('jules_supervisor_state', JSON.stringify(supervisorState));
        }

      } catch (error) {
        addLog(`Error checking sessions: ${error}`, 'error');
      } finally {
        processingRef.current = false;
      }
    };

    // Initial check
    runLoop();
    intervalRef.current = setInterval(runLoop, config.checkIntervalSeconds * 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [config, client, apiKey, addLog, setStatusSummary]);

  return null;
}
