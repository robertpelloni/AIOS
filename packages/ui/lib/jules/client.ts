import type {
  Source,
  Session,
  Activity,
  CreateSessionRequest,
  CreateActivityRequest,
} from "@/types/jules";

interface ApiSource {
  source?: string;
  name?: string;
  [key: string]: unknown;
}

interface ApiSession {
  id: string;
  sourceContext?: {
    source?: string;
    githubRepoContext?: {
      startingBranch?: string;
    };
  };
  title?: string;
  state?: string;
  createTime: string;
  updateTime: string;
  lastActivityAt?: string;
  [key: string]: unknown;
}

interface Plan {
  description?: string;
  summary?: string;
  title?: string;
  steps?: unknown[];
  [key: string]: unknown;
}

interface Artifact {
  changeSet?: {
    gitPatch?: {
      unidiffPatch?: string;
    };
    unidiffPatch?: string;
    [key: string]: unknown;
  };
  bashOutput?: {
    output?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface ApiActivity {
  name?: string;
  id?: string;
  createTime: string;
  originator?: string;
  planGenerated?: {
    plan?: Plan;
    description?: string;
    summary?: string;
    title?: string;
    steps?: unknown[];
    [key: string]: unknown;
  };
  planApproved?: boolean;
  progressUpdated?: {
    progressDescription?: string;
    description?: string;
    message?: string;
    artifacts?: Artifact[];
    [key: string]: unknown;
  };
  sessionCompleted?: {
    summary?: string;
    message?: string;
    artifacts?: Artifact[];
    [key: string]: unknown;
  };
  agentMessaged?: {
    agentMessage?: string;
    message?: string;
    [key: string]: unknown;
  };
  userMessage?: { message?: string; content?: string; [key: string]: unknown };
  artifacts?: Artifact[];
  message?: string;
  content?: string;
  text?: string;
  description?: string;
  diff?: string;
  bashOutput?: string;
  [key: string]: unknown;
}

export class JulesAPIError extends Error {
  constructor(
    message: string,
    public status?: number,
    public response?: unknown,
  ) {
    super(message);
    this.name = "JulesAPIError";
  }
}

export class JulesClient {
  private baseURL = "/api/jules";
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    // Build URL with path as query param for our proxy
    const url = `${this.baseURL}?path=${encodeURIComponent(endpoint)}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "X-Jules-Api-Key": this.apiKey,
          ...options.headers,
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));

        // Handle common HTTP errors with helpful messages
        if (response.status === 401) {
          throw new JulesAPIError(
            "Invalid API key. Please check your Jules API key in settings.",
            response.status,
            error,
          );
        }

        if (response.status === 403) {
          throw new JulesAPIError(
            "Access forbidden. Please ensure your API key has the correct permissions.",
            response.status,
            error,
          );
        }

        if (response.status === 404) {
          // For activities endpoint, 404 just means no activities yet (new session)
          // Return empty array instead of throwing error
          if (endpoint.includes("/activities")) {
            return { activities: [] } as T;
          }

          throw new JulesAPIError(
            "Resource not found. The requested endpoint may not exist.",
            response.status,
            error,
          );
        }

        if (response.status === 503) {
          throw new JulesAPIError(
            "The Jules service is currently unavailable (503). Please try again later.",
            response.status,
            error,
          );
        }

        throw new JulesAPIError(
          error.message || `Request failed with status ${response.status}`,
          response.status,
          error,
        );
      }

      return response.json();
    } catch (error) {
      if (error instanceof JulesAPIError) {
        throw error;
      }

      // Handle network errors with helpful messages
      if (error instanceof TypeError && error.message === "Failed to fetch") {
        throw new JulesAPIError(
          "Unable to connect to the server. Please check your internet connection and try again.",
          undefined,
          error,
        );
      }

      // Generic network error
      throw new JulesAPIError(
        error instanceof Error
          ? error.message
          : "Network request failed. Please try again.",
        undefined,
        error,
      );
    }
  }

  // Sources
  async listSources(): Promise<Source[]> {
    // Fetch all sources with pagination support
    let allSources: ApiSource[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams();
      params.set("pageSize", "100"); // Request max page size
      if (pageToken) {
        params.set("pageToken", pageToken);
      }

      const endpoint = `/sources?${params.toString()}`;
      const response = await this.request<{
        sources?: ApiSource[];
        nextPageToken?: string;
      }>(endpoint);

      if (response.sources) {
        allSources = allSources.concat(response.sources);
      }

      pageToken = response.nextPageToken;
    } while (pageToken);

    // Transform API response to extract repository info
    const sources = allSources.map((source: ApiSource) => {
      // Extract repo name from source field (e.g., "sources/github/owner/repo")
      const sourcePath = source.source || source.name || "";
      const match = sourcePath.match(/sources\/github\/(.+)/);
      const repoPath = match ? match[1] : sourcePath;

      return {
        id: sourcePath, // Keep full path for API calls
        name: repoPath, // Use short name for display
        type: "github" as const,
        metadata: source as Record<string, unknown>,
      };
    });

    // Temporary fix: Add missing repo if not present
    const missingRepo = "sbhavani/dgx-spark-playbooks";
    const missingRepoId = `sources/github/${missingRepo}`;
    if (!sources.some((s) => s.id === missingRepoId)) {
      sources.push({
        id: missingRepoId,
        name: missingRepo,
        type: "github",
        metadata: { source: missingRepoId, name: missingRepoId },
      });
    }

    // Fetch all sessions to determine latest activity per source
    try {
      const allSessions = await this.listSessions();

      // Create a map of sourceId to the most recent activity timestamp
      const latestActivityMap = new Map<string, string>();

      for (const session of allSessions) {
        const sourceId = `sources/github/${session.sourceId}`;
        const activityTime =
          session.lastActivityAt || session.updatedAt || session.createdAt;

        if (
          !latestActivityMap.has(sourceId) ||
          (activityTime && activityTime > latestActivityMap.get(sourceId)!)
        ) {
          latestActivityMap.set(sourceId, activityTime);
        }
      }

      // Sort sources by latest activity (most recent first)
      sources.sort((a, b) => {
        const aTime = latestActivityMap.get(a.id) || "";
        const bTime = latestActivityMap.get(b.id) || "";

        // Sources with activity come before those without
        if (aTime && !bTime) return -1;
        if (!aTime && bTime) return 1;

        // Compare timestamps (descending - most recent first)
        return bTime.localeCompare(aTime);
      });

      console.log(
        "[Jules Client] Loaded sources (sorted by activity):",
        sources.length,
        sources,
      );
    } catch (error) {
      console.error(
        "[Jules Client] Failed to sort sources by activity:",
        error,
      );
      // Continue with unsorted sources if session fetch fails
    }

    return sources;
  }

  async getSource(id: string): Promise<Source> {
    return this.request<Source>(`/sources/${id}`);
  }

  // Sessions
  async listSessions(sourceId?: string): Promise<Session[]> {
    let allSessions: ApiSession[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams();
      params.set('pageSize', '100');
      if (sourceId) params.set('sourceId', sourceId);
      if (pageToken) params.set('pageToken', pageToken);

      const endpoint = `/sessions?${params.toString()}`;
      const response = await this.request<{ sessions?: ApiSession[]; nextPageToken?: string }>(endpoint);

      if (response.sessions) {
        allSessions = allSessions.concat(response.sessions);
      }
      pageToken = response.nextPageToken;
    } while (pageToken);

    // Transform API response to match our Session type
    return allSessions.map((session: ApiSession) => ({
      id: session.id,
      sourceId: session.sourceContext?.source?.replace('sources/github/', '') || '',
      title: session.title || '',
      summary: session.summary as string | undefined,
      status: this.mapState(session.state || ''),
      rawState: session.state, // Pass through original state
      createdAt: session.createTime,
      updatedAt: session.updateTime,
      lastActivityAt: session.lastActivityAt,
      branch:
        session.sourceContext?.githubRepoContext?.startingBranch || "main",
    }));
  }

  private mapState(state: string): Session['status'] {
    // Maps API states to our internal Session status type
    // API States from Python SDK:
    // STATE_UNSPECIFIED, QUEUED, PLANNING, AWAITING_PLAN_APPROVAL,
    // AWAITING_USER_FEEDBACK, IN_PROGRESS, PAUSED, FAILED, COMPLETED
    const stateMap: Record<string, Session['status']> = {
      'COMPLETED': 'completed',
      'ACTIVE': 'active', // Legacy/Simplified
      'PLANNING': 'active',
      'QUEUED': 'active',
      'IN_PROGRESS': 'active',
      'AWAITING_USER_FEEDBACK': 'active',
      'AWAITING_PLAN_APPROVAL': 'awaiting_approval', // New status for plan approval
      'FAILED': 'failed',
      'PAUSED': 'paused'
    };
    return stateMap[state] || "active";
  }

  async getSession(id: string): Promise<Session> {
    return this.request<Session>(`/sessions/${id}`);
  }

  async createSession(data: CreateSessionRequest): Promise<Session> {
    // Jules API requires specific structure per https://developers.google.com/jules/api
    let prompt = data.prompt;
    if (data.autoCreatePr) {
      prompt +=
        "\n\nIMPORTANT: Automatically create a pull request when code changes are ready.";
    }

    const requestBody = {
      prompt: prompt,
      sourceContext: {
        source: data.sourceId,
        githubRepoContext: {
          startingBranch: data.startingBranch || "main", // Default to main branch
        },
      },
      title: data.title || 'Untitled Session',
      requirePlanApproval: true // Enable plan approval as per requirements
    };

    console.log("[Jules Client] Creating session with:", requestBody);

    return this.request<Session>("/sessions", {
      method: "POST",
      body: JSON.stringify(requestBody),
    });
  }

  async updateSession(id: string, data: Partial<Session>): Promise<Session> {
    const body: any = { ...data };
    // Map local status back to API state if needed
    if (data.status) {
        const stateMap: Record<string, string> = {
            'active': 'ACTIVE',
            'completed': 'COMPLETED',
            'failed': 'FAILED',
            'paused': 'PAUSED',
            'awaiting_approval': 'AWAITING_PLAN_APPROVAL'
        };
        if (stateMap[data.status]) {
            body.state = stateMap[data.status];
            delete body.status;
        }
    }

    // Remove fields that shouldn't be sent
    delete body.id;
    delete body.createdAt;
    delete body.updatedAt;
    delete body.lastActivityAt;
    delete body.sourceId; // Usually immutable
    delete body.branch;

    return this.request<Session>(`/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  async deleteSession(id: string): Promise<void> {
    await this.request<void>(`/sessions/${id}`, {
      method: "DELETE",
    });
  }

  async approvePlan(sessionId: string): Promise<void> {
    await this.request<void>(`/sessions/${sessionId}:approvePlan`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }

  async resumeSession(sessionId: string, message?: string): Promise<void> {
    // No direct 'resume' endpoint found in SDK, using createActivity to wake it up.
    // This is a common pattern for resuming paused/completed sessions in agentic workflows.
    await this.createActivity({
      sessionId,
      content: message || 'Please resume working on this task.',
      type: 'message'
    });
  }

  // Activities
  async listActivities(sessionId: string, options?: { maxPages?: number; onProgress?: (activities: Activity[]) => void }): Promise<Activity[]> {
    let allActivities: Activity[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;
    const maxPages = options?.maxPages ?? Infinity; // Default to load all pages

    do {
      const params = new URLSearchParams();
      params.set('pageSize', '100');
      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const endpoint = `/sessions/${sessionId}/activities?${params.toString()}`;
      const response = await this.request<{ activities: ApiActivity[]; nextPageToken?: string }>(endpoint);

      if (response.activities) {
        const newActivities = response.activities.map(activity => this.transformActivity(activity, sessionId));
        allActivities = allActivities.concat(newActivities);
        
        // Notify progress if callback provided
        if (options?.onProgress) {
          options.onProgress(allActivities);
        }
      }

      pageToken = response.nextPageToken;
      pageCount++;

      if (pageCount >= maxPages && pageToken) {
        console.warn(`[Jules Client] Reached max pages (${maxPages}) for activities. Some older activities may be missing.`);
        break;
      }
    } while (pageToken);

    return allActivities;
  }

  private transformActivity(activity: ApiActivity, sessionId: string): Activity {
      // Extract ID from name field (e.g., "sessions/ID/activities/ACTIVITY_ID")
      const id = activity.name?.split("/").pop() || activity.id || "";

      // Determine type and content based on activity structure
      let type: Activity["type"] = "message";
      let content = "";

      // Extract content from various possible fields
      if (activity.planGenerated) {
        type = "plan";
        const plan = activity.planGenerated.plan || activity.planGenerated;
        content =
          plan.description ||
          plan.summary ||
          plan.title ||
          JSON.stringify(plan.steps || plan, null, 2);
      } else if (activity.planApproved) {
        type = "plan";
        content = "Plan approved";
      } else if (activity.progressUpdated) {
        type = "progress";
        content =
          activity.progressUpdated.progressDescription ||
          activity.progressUpdated.description ||
          activity.progressUpdated.message ||
          JSON.stringify(activity.progressUpdated, null, 2);
      } else if (activity.sessionCompleted) {
        type = "result";
        const result = activity.sessionCompleted;
        content = result.summary || result.message || "Session completed";
      }

      // Extract artifacts from top-level artifacts array (applies to all activity types)
      if (activity.artifacts && activity.artifacts.length > 0) {
        for (const artifact of activity.artifacts) {
          // Handle both gitPatch.unidiffPatch and direct unidiffPatch formats
          if (artifact.changeSet?.gitPatch?.unidiffPatch) {
            activity.diff = artifact.changeSet.gitPatch.unidiffPatch;
          } else if (artifact.changeSet?.unidiffPatch) {
            activity.diff = artifact.changeSet.unidiffPatch;
          }
          if (artifact.bashOutput?.output) {
            activity.bashOutput = artifact.bashOutput.output;
          }
        }
      } else if (activity.agentMessaged) {
        type = "message";
        content =
          activity.agentMessaged.agentMessage ||
          activity.agentMessaged.message ||
          "";
      } else if (activity.userMessage) {
        type = 'message';
        // Try more fields including common variations
        const um = activity.userMessage;
        content = um.message || um.content || (um.text as string) || (um.prompt as string) || (typeof um === 'string' ? um : '');

        // If still empty and it's an object, check specific keys before generic stringify
        if (!content && typeof um === 'object' && um !== null) {
             // Avoid stringifying empty objects or internal markers
             if (Object.keys(um).length > 0) {
                 // Try to find any string property that looks like content
                 const stringVal = Object.values(um).find(v => typeof v === 'string' && v.length > 0);
                 if (stringVal) {
                    content = stringVal as string;
                 } else {
                    // Only stringify if it has meaningful data
                    content = JSON.stringify(um);
                 }
             }
        }
      }

      // Fallback: try common content fields
      if (!content) {
        content =
          activity.message ||
          activity.content ||
          activity.text ||
          activity.description ||
          (activity.artifacts
            ? JSON.stringify(activity.artifacts, null, 2)
            : "") ||
          "";
      }

      // Last resort: show activity type but try to dump meaningful content
      if (!content) {
        // Exclude internal fields
        const keys = Object.keys(activity).filter(k => !['name', 'createTime', 'originator', 'id'].includes(k));
        // If we have a specific known key like 'agentMessaged', try to dump it
        const relevantKey = keys.find(k => k.includes('Message') || k.includes('Plan') || k.includes('content'));
        if (relevantKey) {
            content = JSON.stringify(activity[relevantKey]);
        } else {
            content = `[${keys.join(', ')}]`;
        }
      }

      return {
        id,
        sessionId,
        type,
        role: (activity.originator === "agent"
          ? "agent"
          : "user") as Activity["role"],
        content,
        diff: activity.diff, // Include extracted diff if available
        bashOutput: activity.bashOutput, // Include extracted bash output if available
        createdAt: activity.createTime,
        metadata: activity as Record<string, unknown>,
      };
  }

  async getActivity(sessionId: string, activityId: string): Promise<Activity> {
    const response = await this.request<ApiActivity>(
      `/sessions/${sessionId}/activities/${activityId}`,
    );

    return this.transformActivity(response, sessionId);
  }

  async createActivity(data: CreateActivityRequest): Promise<Activity> {
    // Jules API uses :sendMessage endpoint for sending messages
    // Response is empty - agent response will appear in next activity
    await this.request(`/sessions/${data.sessionId}:sendMessage`, {
      method: "POST",
      body: JSON.stringify({ prompt: data.content }),
    });

    // Return a placeholder activity since response is empty
    return {
      id: "pending",
      sessionId: data.sessionId,
      type: "message",
      role: "user",
      content: data.content,
      createdAt: new Date().toISOString(),
    };
  }
}

// Helper to create a client instance
export function createJulesClient(apiKey: string): JulesClient {
  return new JulesClient(apiKey);
}
