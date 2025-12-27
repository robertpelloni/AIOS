import fs from 'fs';
import path from 'path';
import Fuse from 'fuse.js';
import { MemoryProvider, MemoryItem, MemoryResult } from '../../interfaces/MemoryProvider.js';

export class FileMemoryProvider implements MemoryProvider {
    public id = 'default-file';
    public name = 'Local File Storage';
    public type: 'file' = 'file';
    public capabilities: ('read' | 'write' | 'search' | 'delete')[] = ['read', 'write', 'search', 'delete'];

    private memories: MemoryItem[] = [];
    private dataFile: string;
    private fuse: Fuse<MemoryItem>;

    constructor(private dataDir: string) {
        this.dataFile = path.join(dataDir, 'memory.json');
        this.fuse = new Fuse([], {
            keys: ['content', 'tags'],
            threshold: 0.4
        });
    }

    async connect(): Promise<void> {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
        if (fs.existsSync(this.dataFile)) {
            try {
                const data = fs.readFileSync(this.dataFile, 'utf-8');
                this.memories = JSON.parse(data);
                this.fuse.setCollection(this.memories);
                console.log(`[FileMemory] Loaded ${this.memories.length} items`);
            } catch (e) {
                console.error('[FileMemory] Failed to load data:', e);
            }
        }
    }

    async disconnect(): Promise<void> {
        // No-op for file
    }

    async insert(item: MemoryItem): Promise<string> {
        this.memories.push(item);
        this.fuse.setCollection(this.memories);
        this.save();
        return item.id;
    }

    async search(query: string, limit: number = 5, embedding?: number[]): Promise<MemoryResult[]> {
        const results = this.fuse.search(query);
        return results.slice(0, limit).map(r => ({
            ...r.item,
            sourceProvider: this.id,
            similarity: r.score ? 1 - r.score : undefined // Fuse score is distance (0 is best)
        }));
    }

    async delete(id: string): Promise<void> {
        this.memories = this.memories.filter(m => m.id !== id);
        this.fuse.setCollection(this.memories);
        this.save();
    }

    async getAll(): Promise<MemoryItem[]> {
        return this.memories;
    }

    async import(items: MemoryItem[]): Promise<void> {
        this.memories.push(...items);
        this.fuse.setCollection(this.memories);
        this.save();
    }

    private save() {
        fs.writeFileSync(this.dataFile, JSON.stringify(this.memories, null, 2));
    }
}
