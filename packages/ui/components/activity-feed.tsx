"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useJules } from '@/lib/jules/provider';
import type { Activity, Session } from '@/types/jules';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow, isValid, parseISO } from 'date-fns';
import { Send, Archive, Code, Terminal, ChevronDown, ChevronRight, Play, GitBranch, GitPullRequest, MoreVertical, Book, ArrowUp, ArrowDown, Download, Copy, Check, Loader2 } from 'lucide-react';
import { archiveSession } from '@/lib/archive';
import { BashOutput } from '@/components/ui/bash-output';
import { NewSessionDialog } from './new-session-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { BorderGlow } from "./ui/border-glow";
import { ActivityContent } from './activity-content';
import { PlanContent } from './plan-content';
import { ActivityInput } from './activity-input';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ActivityFeedProps {
  session: Session;
  onArchive?: () => void;
  showCodeDiffs: boolean;
  onToggleCodeDiffs: (show: boolean) => void;
  onActivitiesChange: (activities: Activity[]) => void;
}

export function ActivityFeed({
  session,
  onArchive,
  showCodeDiffs,
  onToggleCodeDiffs,
  onActivitiesChange,
}: ActivityFeedProps) {
  const { client } = useJules();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [approvingPlan, setApprovingPlan] = useState(false);
  const [newActivityIds, setNewActivityIds] = useState<Set<string>>(new Set());
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [expandedBashOutputs, setExpandedBashOutputs] = useState<Set<string>>(new Set());

  const formatDate = (dateString: string) => {
    if (!dateString) return "Unknown date";
    try {
      const date = parseISO(dateString);
      if (!isValid(date)) return "Unknown date";
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return "Unknown date";
    }
  };

  const formatContent = (content: string) => {
    // Try to parse as JSON and format nicely
    try {
      const parsed = JSON.parse(content);

      // If it's an array (like plan steps) or object with steps, use PlanContent
      if (
        Array.isArray(parsed) ||
        (parsed.steps && Array.isArray(parsed.steps))
      ) {
        return <PlanContent content={parsed} />;
      }

      // Otherwise return formatted JSON
      return (
        <pre className="text-[11px] overflow-x-auto font-mono bg-muted/50 p-2 rounded">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
    } catch {
      // Not JSON, render as markdown
      return (
        <div className="prose prose-sm dark:prose-invert max-w-none break-words prose-p:text-xs prose-p:leading-relaxed prose-p:break-words prose-headings:text-xs prose-headings:font-semibold prose-headings:mb-1 prose-headings:mt-2 prose-ul:text-xs prose-ol:text-xs prose-li:text-xs prose-li:my-0.5 prose-code:text-[11px] prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:break-all prose-pre:text-[11px] prose-pre:bg-muted prose-pre:p-2 prose-pre:overflow-x-auto prose-blockquote:text-xs prose-blockquote:border-l-primary prose-strong:font-semibold">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      );
    }
  };

  const loadActivities = useCallback(async (isInitialLoad = true) => {
    if (!client) {
      setLoading(false);
      return;
    }

    try {
      if (isInitialLoad) setLoading(true);
      setError(null);

      // Get session details to ensure we have the prompt
      const sessionDetails = await client.getSession(session.id);
      
      const updateActivitiesState = (fetchedActivities: Activity[]) => {
        // Prepend initial prompt if missing
        if (sessionDetails.prompt) {
           const hasPrompt = fetchedActivities.some(a => a.id === 'initial-prompt' || a.content === sessionDetails.prompt);
           if (!hasPrompt) {
              fetchedActivities.unshift({
                id: 'initial-prompt',
                sessionId: session.id,
                type: 'message',
                role: 'user',
                content: sessionDetails.prompt,
                createdAt: session.createdAt
              });
           }
        }

        setActivities(prevActivities => {
          if (prevActivities.length === 0 || isInitialLoad) return fetchedActivities;

          const newActivities = fetchedActivities.filter(
            newAct => !prevActivities.some(prevAct => prevAct.id === newAct.id)
          );

          if (newActivities.length > 0) {
            setNewActivityIds(new Set(newActivities.map(a => a.id)));
            setTimeout(() => setNewActivityIds(new Set()), 500);

            // Deduplicate pending messages
            const newContentCounts = new Map<string, number>();
            newActivities.forEach(a => {
              if (a.role === 'user') {
                newContentCounts.set(a.content, (newContentCounts.get(a.content) || 0) + 1);
              }
            });

            const filteredPrev = prevActivities.filter(a => {
              if (a.id === 'pending' && a.role === 'user') {
                const count = newContentCounts.get(a.content);
                if (count && count > 0) {
                  newContentCounts.set(a.content, count - 1);
                  return false; // Remove this pending item
                }
              }
              return true;
            });

            return [...filteredPrev, ...newActivities];
          }
          return prevActivities;
        });
      };

      const data = await client.listActivities(session.id, {
        onProgress: (partialActivities) => {
            updateActivitiesState(partialActivities);
        }
      });
      
      // Final consistency check
      updateActivitiesState(data);

    } catch (err) {
      console.error('Failed to load activities:', err);
      if (err instanceof Error && err.message.includes('Resource not found')) {
        setActivities([]);
        setError(null);
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load activities';
        setError(errorMessage);
        if (isInitialLoad) setActivities([]);
      }
    } finally {
      if (isInitialLoad) setLoading(false);
    }
  }, [client, session.id, session.createdAt]);

  useEffect(() => {
    loadActivities(true);
    if (session.status === 'active') {
      // Increased polling interval to 10s to avoid rate limits
      const interval = setInterval(() => loadActivities(false), 10000);
      return () => clearInterval(interval);
    }
  }, [session.id, session.status, loadActivities]);

  useEffect(() => {
    onActivitiesChange(activities);
  }, [activities, onActivitiesChange]);

  const handleApprovePlan = async () => {
    if (!client || approvingPlan) return;
    try {
      setApprovingPlan(true);
      setError(null);
      await client.approvePlan(session.id);
      setTimeout(async () => {
        try {
          await loadActivities(false);
        } catch (err) {
          console.error("Failed to load activities after approval:", err);
        }
      }, 1000);
    } catch (err) {
      console.error("Failed to approve plan:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to approve plan";
      setError(errorMessage);
    } finally {
      setApprovingPlan(false);
    }
  };

  const sendAgentCommand = async (commandPrompt: string) => {
    if (!client || sending) return;

    try {
      setSending(true);
      setError(null);

      // Send message
      const userMessage = await client.createActivity({
        sessionId: session.id,
        content: commandPrompt,
      });

      // Add user message to activities immediately
      setActivities([...activities, userMessage]);

      // Poll for agent's response after a short delay
      setTimeout(async () => {
        try {
          await loadActivities(false);
        } catch (err) {
          console.error("Failed to load new activities:", err);
        }
      }, 2000);
    } catch (err) {
      console.error("Failed to send command:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to send command";
      setError(errorMessage);
    } finally {
      setSending(false);
    }
  };

  const handleQuickReview = async () => {
    await sendAgentCommand(
      "Please perform a comprehensive code review of the repository. Look for bugs, security issues, and opportunities for refactoring. Provide a detailed summary of your findings.",
    );
  };

  const handleSendMessage = async (content: string) => {
    if (!client || sending) return;
    try {
      setSending(true);
      setError(null);
      const userMessage = await client.createActivity({
        sessionId: session.id,
        content: content.trim(),
      });
      setActivities(prev => [...prev, userMessage]);

      // Poll for agent's response after a short delay
      setTimeout(async () => {
        try {
          await loadActivities(false);
        } catch (err) {
          console.error("Failed to load new activities:", err);
        }
      }, 2000);
    } catch (err) {
      console.error("Failed to send message:", err);
      const errorMessage = err instanceof Error ? err.message : "Failed to send message";
      setError(errorMessage);
    } finally {
      setSending(false);
    }
  };

  const handleArchive = () => {
    archiveSession(session.id);
    onArchive?.();
  };

  const toggleCodeDiffsSidebar = () => {
    onToggleCodeDiffs(!showCodeDiffs);
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleExport = (format: 'json' | 'txt' | 'md') => {
    let content = '';
    const filename = `session-${session.id.substring(0, 8)}.${format}`;

    if (format === 'json') {
      content = JSON.stringify(activities, null, 2);
    } else {
      content = activities.map(a => {
        const header = `[${formatDate(a.createdAt)}] ${a.role.toUpperCase()} (${a.type})`;
        return format === 'md'
          ? `### ${header}\n\n${a.content}\n\n`
          : `${header}\n${a.content}\n\n-------------------\n\n`;
      }).join('');
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const scrollToTop = () => {
    const scrollContainer = document.querySelector('#activity-feed-scroll-area [data-radix-scroll-area-viewport]');
    if (scrollContainer) scrollContainer.scrollTop = 0;
  };

  const scrollToBottom = () => {
    const scrollContainer = document.querySelector('#activity-feed-scroll-area [data-radix-scroll-area-viewport]');
    if (scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
      setShouldAutoScroll(true);
    }
  };

  // Auto-scroll effect
  useEffect(() => {
    if (shouldAutoScroll && activities.length > 0) {
      const timer = setTimeout(() => {
        const scrollContainer = document.querySelector('#activity-feed-scroll-area [data-radix-scroll-area-viewport]');
        if (scrollContainer) {
          scrollContainer.scrollTop = scrollContainer.scrollHeight;
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [activities, shouldAutoScroll]);

  // Detect manual scroll to disable auto-scroll
  useEffect(() => {
    const scrollContainer = document.querySelector('#activity-feed-scroll-area [data-radix-scroll-area-viewport]');
    if (!scrollContainer) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 50;
      
      if (isAtBottom) {
        setShouldAutoScroll(true);
      } else {
        setShouldAutoScroll(false);
      }
    };

    scrollContainer.addEventListener('scroll', handleScroll);
    return () => scrollContainer.removeEventListener('scroll', handleScroll);
  }, []);

  const finalDiff = activities.filter(activity => activity.diff).slice(-1);
  const hasDiffs = finalDiff.length > 0;
  const outputBranch = session.branch || 'main';

  const toggleBashOutput = (activityId: string) => {
    setExpandedBashOutputs((prev) => {
      const next = new Set(prev);
      if (next.has(activityId)) next.delete(activityId);
      else next.add(activityId);
      return next;
    });
  };

  const getActivityIcon = (activity: Activity) => {
    if (activity.role === "user") {
      return (
        <AvatarFallback className="bg-purple-500 text-white text-[9px] font-bold uppercase tracking-wider">
          U
        </AvatarFallback>
      );
    }
    return <AvatarFallback className="bg-white text-black text-[9px] font-bold uppercase tracking-wider">J</AvatarFallback>;
  };

  const getActivityTypeColor = (type: Activity['type']) => {
    switch (type) {
      case 'message': return 'bg-blue-500';
      case 'plan': return 'bg-purple-500';
      case 'progress': return 'bg-yellow-500';
      case 'result': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  // Filter activities
  const filteredActivities = useMemo(() => activities.filter((activity) => {
    if (activity.bashOutput || activity.diff) return true;
    const content = activity.content?.trim();
    if (!content) return false;
    
    // Aggressive filter for empty JSON/Arrays
    const cleanContent = content.replace(/\s/g, '');
    if (cleanContent === '{}' || cleanContent === '[]') return false;

    // Filter empty parsed JSON objects
    if (content.startsWith('{') || content.startsWith('[')) {
      try {
        const parsed = JSON.parse(content);
        if (typeof parsed === 'object' && parsed !== null) {
          if (Array.isArray(parsed) && parsed.length === 0) return false;
          if (!Array.isArray(parsed) && Object.keys(parsed).length === 0) return false;
        }
      } catch {
        // Not valid JSON, process as text
      }
    }
    return true;
  }), [activities]);

  const latestActivity = filteredActivities.length > 0 ? filteredActivities[filteredActivities.length - 1] : null;
  const sessionDuration = session.createdAt ? Math.floor((new Date().getTime() - new Date(session.createdAt).getTime()) / 1000 / 60) : 0;

  const getStatusInfo = () => {
    if (session.status === 'active') return { color: 'text-green-500', bgColor: 'bg-green-500/10', label: 'Active', icon: '●' };
    if (session.status === 'completed') return { color: 'text-blue-500', bgColor: 'bg-blue-500/10', label: 'Completed', icon: '✓' };
    if (session.status === 'failed') return { color: 'text-red-500', bgColor: 'bg-red-500/10', label: 'Failed', icon: '✕' };
    if (session.status === 'paused') return { color: 'text-yellow-500', bgColor: 'bg-yellow-500/10', label: 'Paused', icon: '⏸' };
    return { color: 'text-gray-500', bgColor: 'bg-gray-500/10', label: session.status, icon: '○' };
  };

  const statusInfo = getStatusInfo();

  const groupedActivities = useMemo(() => {
    // Group consecutive progress activities from the same role
    const grouped: Array<Activity | Activity[]> = [];
    let currentGroup: Activity[] | null = null;

    filteredActivities.forEach((activity, index) => {
      const shouldGroup =
        activity.type === "progress" && activity.role === "agent";
      const prevActivity = index > 0 ? filteredActivities[index - 1] : null;
      const prevShouldGroup =
        prevActivity &&
        prevActivity.type === "progress" &&
        prevActivity.role === "agent";

      if (shouldGroup) {
        if (prevShouldGroup && currentGroup) {
          currentGroup.push(activity);
        } else {
          currentGroup = [activity];
          grouped.push(currentGroup);
        }
      } else {
        currentGroup = null;
        grouped.push(activity);
      }
    });

    return grouped;
  }, [filteredActivities]);

  if (loading && activities.length === 0) {
    return (
      <div className="flex items-center justify-center h-full bg-black">
        <p className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
          Loading activities...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-black relative">
      <div className="border-b border-white/[0.08] bg-zinc-950/95 px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <h2 className="text-sm font-bold uppercase tracking-wide truncate text-white">
                {session.title}
              </h2>
              <div
                className={`flex items-center gap-1 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider ${statusInfo.bgColor} ${statusInfo.color}`}
              >
                <span>{statusInfo.icon}</span>
                <span>{statusInfo.label}</span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[9px] font-mono text-white/40 uppercase tracking-wide">
              <span>Started {formatDate(session.createdAt)}</span>
              <span>•</span>
              <div className="flex items-center gap-1 text-white/60">
                <Book className="h-3 w-3" />
                <span>{session.sourceId}</span>
              </div>
              <span>•</span>
              <div className="flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                <span>{session.branch || "main"}</span>
              </div>
              {session.status === "active" && (
                <>
                  <span>•</span>
                  <span>Running {sessionDuration}m</span>
                </>
              )}
            </div>
            {session.status === "active" && (
              <div className="mt-2 pt-2 border-t border-white/[0.08]">
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-purple-400">
                    Latest Activity
                  </div>
                  {latestActivity && (
                    <div className="text-[8px] font-mono text-white/30 tracking-wide">
                      {formatDate(latestActivity.createdAt)}
                    </div>
                  )}
                </div>
                <div className="text-[11px] text-white/80 line-clamp-2 leading-relaxed font-mono">
                  {latestActivity ? (
                    (() => {
                      try {
                        const parsed = JSON.parse(latestActivity.content);
                        if (typeof parsed === "string") {
                          return parsed.length > 150
                            ? parsed.substring(0, 150) + "..."
                            : parsed;
                        }
                        return latestActivity.content.length > 150
                          ? latestActivity.content.substring(0, 150) + "..."
                          : latestActivity.content;
                      } catch {
                        return latestActivity.content.length > 150
                          ? latestActivity.content.substring(0, 150) + "..."
                          : latestActivity.content;
                      }
                    })()
                  ) : (
                    <span className="text-white/30 uppercase tracking-wide text-[10px]">
                      Waiting for updates...
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {hasDiffs && (
              <Button variant="ghost" size="icon" onClick={toggleCodeDiffsSidebar} className={`h-7 w-7 hover:bg-white/5 ${showCodeDiffs ? 'bg-purple-500/20 text-purple-400' : 'text-white/60'}`}>
                <Code className="h-3.5 w-3.5" />
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="More actions"
                  className="h-7 w-7 hover:bg-white/5 text-white/60"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 bg-zinc-950 border-white/10 text-white/80">
                {session.status === "active" && (
                  <DropdownMenuItem
                    onClick={handleQuickReview}
                    disabled={sending}
                    className="focus:bg-white/10 focus:text-white text-xs cursor-pointer"
                  >
                    <Play className="mr-2 h-3.5 w-3.5" />
                    <span>Start Code Review</span>
                  </DropdownMenuItem>
                )}
                {session.status === "completed" && hasDiffs && (
                  <NewSessionDialog
                    trigger={
                      <DropdownMenuItem
                        onSelect={(e) => e.preventDefault()}
                        className="focus:bg-white/10 focus:text-white text-xs cursor-pointer"
                      >
                        <GitPullRequest className="mr-2 h-3.5 w-3.5" />
                        <span>Review & Create PR</span>
                      </DropdownMenuItem>
                    }
                    initialValues={{
                      sourceId: session.sourceId
                        ? `sources/github/${session.sourceId}`
                        : undefined,
                      title: outputBranch
                        ? `Review: ${outputBranch}`
                        : "PR Review",
                      prompt:
                        "Review the changes in this branch. Verify they meet the requirements, check for bugs, and draft a Pull Request description.",
                      startingBranch: outputBranch || undefined,
                    }}
                  />
                )}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="text-xs">
                    <Download className="mr-2 h-3.5 w-3.5" /> Export Chat
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="bg-zinc-950 border-white/10 text-white/80">
                    <DropdownMenuItem onClick={() => handleExport('md')} className="text-xs cursor-pointer">Markdown</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport('txt')} className="text-xs cursor-pointer">Text</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport('json')} className="text-xs cursor-pointer">JSON</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem onClick={() => handleCopy(JSON.stringify(activities, null, 2), 'full')} className="text-xs cursor-pointer">
                  {copiedId === 'full' ? <Check className="mr-2 h-3.5 w-3.5 text-green-500" /> : <Copy className="mr-2 h-3.5 w-3.5" />}
                  Copy Full JSON
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem onClick={handleArchive} className="text-xs cursor-pointer text-red-400 focus:text-red-400">
                  <Archive className="mr-2 h-3.5 w-3.5" />
                  Archive Session
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {error && (
        <div className="border-b border-white/[0.08] bg-red-950/20 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-mono text-red-400 uppercase tracking-wide">
              {error}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadActivities(true)}
              className="h-7 text-[10px] font-mono uppercase tracking-wider border-white/10 hover:bg-white/5 text-white/80"
            >
              Retry
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden relative group">
        <ScrollArea className="h-full" ref={scrollAreaRef} id="activity-feed-scroll-area">
          <div className="p-3 space-y-2.5">
            {filteredActivities.length === 0 && !loading && !error && (
              <div className="flex items-center justify-center min-h-[200px]">
                <div className="text-center space-y-2">
                  <p className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
                    No activities yet
                  </p>
                  {session.status !== "completed" &&
                    session.status !== "failed" && (
                      <p className="text-[9px] font-mono text-white/30 uppercase tracking-wide">
                        Session may be queued or in progress
                      </p>
                    )}
                </div>
              </div>
            )}
            {groupedActivities.map((item, groupIndex) => {
                if (Array.isArray(item)) {
                  const firstActivity = item[0];
                  // Filter nulls (empty JSONs that slipped)
                  const validItems = item.filter(a => {
                    const c = a.content?.trim();
                    return c && c !== '{}' && c !== '[]';
                  });
                  if (validItems.length === 0) return null;

                  return (
                    <div key={`group-${groupIndex}`} className="flex gap-2.5">
                      <Avatar className="h-6 w-6 shrink-0 mt-0.5 bg-zinc-900 border border-white/10">
                        {getActivityIcon(firstActivity)}
                      </Avatar>
                      <BorderGlow
                        className="flex-1 min-w-0"
                        containerClassName="bg-zinc-950/50"
                      >
                        <Card className="border-0 bg-transparent">
                          <CardContent className="p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge
                                variant="outline"
                                className="text-[9px] h-4 px-1.5 font-mono uppercase tracking-wider bg-yellow-500/90 border-transparent text-black font-bold"
                              >
                                progress
                              </Badge>
                              <span className="text-[9px] font-mono text-white/40 tracking-wide">
                                {item.length} update{item.length > 1 ? "s" : ""}
                              </span>
                            </div>
                            <div className="space-y-2">
                              {item.map((activity, activityIndex) => (
                                <div
                                  key={activity.id}
                                  className={
                                    activityIndex > 0
                                      ? "pt-2 border-t border-white/[0.08]"
                                      : ""
                                  }
                                >
                                  <div className="text-[8px] font-mono text-white/30 mb-1 uppercase tracking-wide">
                                    {formatDate(activity.createdAt)}
                                  </div>
                                  <div className="text-[11px] leading-relaxed text-white/90 break-words">
                                    <ActivityContent content={activity.content} metadata={activity.metadata} />
                                  </div>
                                  {activity.bashOutput && activity.bashOutput.trim().length > 0 && (
                                    <div className="mt-2 pt-2 border-t border-white/[0.05]">
                                      <button
                                        onClick={() =>
                                          toggleBashOutput(activity.id)
                                        }
                                        aria-expanded={expandedBashOutputs.has(
                                          activity.id,
                                        )}
                                        aria-label={
                                          expandedBashOutputs.has(activity.id)
                                            ? "Collapse command output"
                                            : "Expand command output"
                                        }
                                        className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-wider text-green-400 hover:text-green-300 transition-colors mb-2"
                                      >
                                        {expandedBashOutputs.has(
                                          activity.id,
                                        ) ? (
                                          <ChevronDown className="h-3 w-3" />
                                        ) : (
                                          <ChevronRight className="h-3 w-3" />
                                        )}
                                        <Terminal className="h-3 w-3" />
                                        <span>Command Output</span>
                                      </button>
                                      {expandedBashOutputs.has(activity.id) && (
                                        <BashOutput
                                          output={activity.bashOutput}
                                        />
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      </BorderGlow>
                    </div>
                  );
                }

                const activity = item;
                // Only show approve button if session is waiting for approval AND this is the latest plan
                const showApprove = activity.type === 'plan' && session.status === 'awaiting_approval';

                return (
                  <div
                    key={activity.id}
                    className={`flex gap-2.5 ${activity.role === "user" ? "flex-row-reverse" : ""} ${
                      newActivityIds.has(activity.id)
                        ? "animate-in fade-in slide-in-from-bottom-2 duration-500"
                        : ""
                    }`}
                  >
                    <Avatar className="h-6 w-6 shrink-0 mt-0.5 bg-zinc-900 border border-white/10">
                      {getActivityIcon(activity)}
                    </Avatar>
                    {activity.role === "user" ? (
                      <Card className="flex-1 min-w-0 border-white/[0.08] bg-purple-950/20 border-purple-500/20">
                        <CardContent className="p-3 group/card relative">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge
                              variant="outline"
                              className={`text-[9px] h-4 px-1.5 font-mono uppercase tracking-wider ${getActivityTypeColor(activity.type)} border-transparent text-black font-bold`}
                            >
                              {activity.type}
                            </Badge>
                            <span className="text-[9px] font-mono text-white/40 tracking-wide">
                              {formatDate(activity.createdAt)}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-4 w-4 ml-auto opacity-0 group-hover/card:opacity-100 transition-opacity"
                              onClick={() => handleCopy(activity.content, activity.id)}
                            >
                              {copiedId === activity.id ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-white/40" />}
                            </Button>
                          </div>
                          <div className="text-[11px] leading-relaxed text-white/90 break-words">
                            <ActivityContent content={activity.content} metadata={activity.metadata} />
                          </div>
                        </CardContent>
                      </Card>
                    ) : (
                      <BorderGlow
                        className="flex-1 min-w-0"
                        containerClassName="bg-zinc-950/50"
                      >
                        <Card className="border-0 bg-transparent">
                          <CardContent className="p-3 group/card relative">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge
                                variant="outline"
                                className={`text-[9px] h-4 px-1.5 font-mono uppercase tracking-wider ${getActivityTypeColor(activity.type)} border-transparent text-black font-bold`}
                              >
                                {activity.type}
                              </Badge>
                              <span className="text-[9px] font-mono text-white/40 tracking-wide">
                                {formatDate(activity.createdAt)}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-4 w-4 ml-auto opacity-0 group-hover/card:opacity-100 transition-opacity"
                                onClick={() => handleCopy(activity.content, activity.id)}
                              >
                                {copiedId === activity.id ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-white/40" />}
                              </Button>
                            </div>
                            <div className="text-[11px] leading-relaxed text-white/90 break-words">
                              <ActivityContent content={activity.content} metadata={activity.metadata} />
                            </div>
                            {activity.bashOutput && activity.bashOutput.trim().length > 0 && (
                              <div className="mt-3 pt-3 border-t border-white/[0.08]">
                                <button
                                  onClick={() => toggleBashOutput(activity.id)}
                                  aria-expanded={expandedBashOutputs.has(
                                    activity.id,
                                  )}
                                  aria-label={
                                    expandedBashOutputs.has(activity.id)
                                      ? "Collapse command output"
                                      : "Expand command output"
                                  }
                                  className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-green-400 hover:text-green-300 transition-colors mb-2"
                                >
                                  {expandedBashOutputs.has(activity.id) ? (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  )}
                                  <Terminal className="h-3.5 w-3.5" />
                                  <span>Command Output</span>
                                </button>
                                {expandedBashOutputs.has(activity.id) && (
                                  <BashOutput output={activity.bashOutput} />
                                )}
                              </div>
                            )}
                            {showApprove && (
                              <div className="mt-3 pt-3 border-t border-white/[0.08]">
                                <Button
                                  onClick={handleApprovePlan}
                                  disabled={approvingPlan}
                                  size="sm"
                                  className="h-7 px-3 text-[9px] font-mono uppercase tracking-widest bg-purple-600 hover:bg-purple-500 text-white border-0"
                                >
                                  {approvingPlan ? (
                                    <>
                                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                                      Approving...
                                    </>
                                  ) : (
                                    "Approve Plan"
                                  )}
                                </Button>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </BorderGlow>
                    )}
                  </div>
                );
              })}
          </div>
        </ScrollArea>

        {/* Floating Jump Buttons */}
        <div className="absolute right-4 bottom-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50">
          <Button variant="secondary" size="icon" className="h-8 w-8 rounded-full shadow-lg bg-zinc-900 border border-white/10 hover:bg-zinc-800" onClick={scrollToTop} title="Jump to Top">
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button variant="secondary" size="icon" className="h-8 w-8 rounded-full shadow-lg bg-zinc-900 border border-white/10 hover:bg-zinc-800" onClick={scrollToBottom} title="Jump to Bottom">
            <ArrowDown className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {session.status !== "failed" && (
        <ActivityInput 
          onSendMessage={handleSendMessage} 
          disabled={sending} 
          placeholder="Send a message to Jules..." 
        />
      )}
      {session.status === "failed" && (
        <div className="border-t border-white/[0.08] bg-zinc-950/95 p-3 text-center">
          <p className="text-[10px] font-mono text-white/40 uppercase tracking-widest">
            Session {session.status} • Cannot send new messages
          </p>
        </div>
      )}
    </div>
  );
}
