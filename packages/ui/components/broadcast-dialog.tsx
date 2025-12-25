"use client";

import { useState } from "react";
import { useJules } from "@/lib/jules/provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Megaphone } from "lucide-react";
import type { Session } from "@/types/jules";

interface BroadcastDialogProps {
  sessions: Session[];
}

const TEMPLATES = [
  {
    label: "Merge & Update",
    text: "Please merge all feature branches into main and also update all submodules and any upstream changes, correcting any issues, then update your local branch to main so that you are working with the latest changes."
  },
  {
    label: "Reanalyze & Check Features",
    text: "Outstanding. Please reanalyze the project and conversation history and determine if there are any further features to implement."
  },
  {
    label: "Roadmap & Documentation",
    text: "Please closely analyze the entire conversation history in full and note every feature, package, implementation detail, etc, and organize them into the roadmap and documentation, noting what has already been accomplished and what is not done yet. Please then continue work on the next feature."
  },
  {
    label: "Update Docs & Push",
    text: "Please update changelog and version number, documentation and roadmap, commit and push to git."
  },
  {
    label: "Update, Fix & Redeploy",
    text: "Please update all submodules, merge in upstream changes (including for forked submodules), fix any issues, update changelog and version number, documentation and roadmap. Commit and push changes for each repository, then redeploy."
  }
];

export function BroadcastDialog({ sessions }: BroadcastDialogProps) {
  const { client } = useJules();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);

  // Use all provided sessions regardless of status, assuming the parent filters for "open" (unarchived) sessions
  const targetSessions = sessions;

  const handleSend = async () => {
    if (!client || !message.trim()) return;

    setSending(true);
    setProgress(0);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < targetSessions.length; i++) {
      const session = targetSessions[i];
      try {
        await client.createActivity({
          sessionId: session.id,
          content: message,
          type: 'message'
        });
        successCount++;
      } catch (error) {
        console.error(`Failed to send to session ${session.id}:`, error);
        failCount++;
      }
      setProgress(Math.round(((i + 1) / targetSessions.length) * 100));
    }

    setSending(false);
    setOpen(false);
    setMessage("");
    setProgress(0);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-white" title="Broadcast to all open sessions">
          <Megaphone className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-zinc-950 border-white/10 text-white">
        <DialogHeader>
          <DialogTitle>Broadcast Message</DialogTitle>
          <DialogDescription className="text-zinc-400">
            Send a message to all {targetSessions.length} open sessions simultaneously.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label className="text-white">Template</Label>
            <Select onValueChange={(value) => setMessage(value)}>
              <SelectTrigger className="bg-zinc-900 border-white/10 text-white">
                <SelectValue placeholder="Select a template..." />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-white/10 text-white">
                {TEMPLATES.map((template, index) => (
                  <SelectItem key={index} value={template.text} className="focus:bg-white/10 focus:text-white cursor-pointer">
                    {template.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="message" className="text-white">Message</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your message here..."
              className="bg-zinc-900 border-white/10 text-white min-h-[100px]"
            />
          </div>
          {sending && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-zinc-400">
                <span>Sending...</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-purple-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button 
            onClick={handleSend} 
            disabled={sending || !message.trim() || targetSessions.length === 0}
            className="bg-purple-600 hover:bg-purple-500 text-white"
          >
            {sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              "Send Broadcast"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
