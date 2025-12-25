import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

export interface Prompt {
    name: string;
    content: string;
    description: string;
}

export class PromptManager extends EventEmitter {
    private watcher: fs.FSWatcher | null = null;
    private prompts: Map<string, Prompt> = new Map();

    constructor(private promptsDir: string) {
        super();
    }

    async start() {
        if (!fs.existsSync(this.promptsDir)) {
            fs.mkdirSync(this.promptsDir, { recursive: true });
        }

        this.watcher = fs.watch(this.promptsDir, (eventType, filename) => {
            if (filename) {
                this.loadPrompt(path.join(this.promptsDir, filename));
            }
        });

        this.loadAll();
    }

    private loadAll() {
        const files = fs.readdirSync(this.promptsDir);
        for (const file of files) {
            this.loadPrompt(path.join(this.promptsDir, file));
        }
    }

    private loadPrompt(filepath: string) {
        if (!fs.existsSync(filepath)) return;
        try {
            const content = fs.readFileSync(filepath, 'utf-8');
            const name = path.basename(filepath, path.extname(filepath));
            this.prompts.set(name, {
                name,
                content,
                description: `Prompt: ${name}`
            });
            this.emit('updated', this.getPrompts());
        } catch (e) {
            console.error(`Failed to load prompt ${filepath}`, e);
        }
    }

    getPrompts(): Prompt[] {
        return Array.from(this.prompts.values());
    }

    getPromptContent(name: string, variables: Record<string, string> = {}): string | null {
        const prompt = this.prompts.get(name);
        if (!prompt) return null;

        let content = prompt.content;
        for (const [key, value] of Object.entries(variables)) {
            // Replace {{key}}
            content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
        }
        return content;
    }
}
