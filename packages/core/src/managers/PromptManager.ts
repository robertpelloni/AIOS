import fs from 'fs';
import chokidar from 'chokidar';
import path from 'path';
import { EventEmitter } from 'events';

export interface Prompt {
    name: string;
    content: string;
    description: string;
}

export class PromptManager extends EventEmitter {
    private watcher: chokidar.FSWatcher | null = null;
    private prompts: Map<string, Prompt> = new Map();

    constructor(private promptsDir: string) {
        super();
    }

    async start() {
        if (!fs.existsSync(this.promptsDir)) {
            fs.mkdirSync(this.promptsDir, { recursive: true });
        }

        this.watcher = chokidar.watch(this.promptsDir, {
            ignored: /(^|[\/\\])\../,
            persistent: true
        });

        this.watcher
            .on('add', (filepath) => this.loadPrompt(filepath))
            .on('change', (filepath) => this.loadPrompt(filepath))
            .on('unlink', (filepath) => this.removePrompt(filepath));

        console.log(`[PromptManager] Watching ${this.promptsDir}`);
    }

    private loadPrompt(filepath: string) {
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

    private removePrompt(filepath: string) {
        const name = path.basename(filepath, path.extname(filepath));
        this.prompts.delete(name);
        this.emit('updated', this.getPrompts());
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
