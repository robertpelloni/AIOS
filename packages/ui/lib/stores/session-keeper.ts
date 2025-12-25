import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SessionKeeperConfig } from '@/types/jules';

export interface Log {
  time: string;
  message: string;
  type: 'info' | 'action' | 'error' | 'skip';
}

export interface StatusSummary {
  monitoringCount: number;
  lastAction: string;
  nextCheckIn: number;
}

export interface SessionState {
  error?: { code: number; message: string; timestamp: number };
  ignoreUntil?: number;
  lastActivitySnippet?: string;
}

interface SessionKeeperState {
  config: SessionKeeperConfig;
  logs: Log[];
  statusSummary: StatusSummary;
  sessionStates: Record<string, SessionState>;
  setConfig: (config: SessionKeeperConfig) => void;
  addLog: (message: string, type: Log['type']) => void;
  clearLogs: () => void;
  setStatusSummary: (summary: Partial<StatusSummary>) => void;
  updateSessionState: (sessionId: string, state: Partial<SessionState>) => void;
}

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
  debateEnabled: false,
  debateParticipants: []
};

export const useSessionKeeperStore = create<SessionKeeperState>()(
  persist(
    (set) => ({
      config: DEFAULT_CONFIG,
      logs: [],
      statusSummary: { monitoringCount: 0, lastAction: 'None', nextCheckIn: 0 },
      sessionStates: {},

      setConfig: (config) => set({ config }),

      addLog: (message, type) => set((state) => ({
        logs: [{
          time: new Date().toLocaleTimeString(),
          message,
          type
        }, ...state.logs].slice(0, 100)
      })),

      clearLogs: () => set({ logs: [] }),

      setStatusSummary: (summary) => set((state) => ({
        statusSummary: { ...state.statusSummary, ...summary }
      })),

      updateSessionState: (sessionId, newState) => set((state) => ({
        sessionStates: {
          ...state.sessionStates,
          [sessionId]: {
            ...state.sessionStates[sessionId],
            ...newState
          }
        }
      })),
    }),
    {
      name: 'jules-session-keeper-store',
      partialize: (state) => ({ config: state.config }), // Only persist config
    }
  )
);
