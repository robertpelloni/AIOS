import { Pinecone, PineconeRecord, RecordMetadata } from '@pinecone-database/pinecone';
import { MemoryProvider, MemoryItem, MemoryResult } from '../../interfaces/MemoryProvider.js';

export class PineconeMemoryProvider implements MemoryProvider {
    public id = 'pinecone';
    public name = 'Pinecone Vector DB';
    public type: 'vector' = 'vector';
    public capabilities: ('read' | 'write' | 'search' | 'delete')[] = ['read', 'write', 'search', 'delete'];

    private client: Pinecone | null = null;
    private indexName: string;
    private apiKey: string;

    constructor(apiKey: string, indexName: string) {
        this.apiKey = apiKey;
        this.indexName = indexName;
    }

    async connect(): Promise<void> {
        try {
            this.client = new Pinecone({
                apiKey: this.apiKey
            });
            // Verify index exists or connection works
            const index = this.client.index(this.indexName);
            await index.describeIndexStats();
            console.log(`[Pinecone] Connected to index: ${this.indexName}`);
        } catch (e) {
            console.error('[Pinecone] Connection failed:', e);
            throw e;
        }
    }

    async disconnect(): Promise<void> {
        this.client = null;
    }

    async insert(item: MemoryItem): Promise<string> {
        if (!this.client) throw new Error('Pinecone client not connected');
        if (!item.embedding) throw new Error('Cannot insert item without embedding into Pinecone');

        const index = this.client.index(this.indexName);
        
        const metadata: RecordMetadata = {
            content: item.content,
            tags: item.tags.join(','), // Pinecone metadata values must be strings, numbers, booleans, or arrays of strings
            timestamp: item.timestamp,
            ...item.metadata
        };

        const record: PineconeRecord = {
            id: item.id,
            values: item.embedding,
            metadata
        };

        await index.upsert([record]);
        return item.id;
    }

    async search(query: string, limit: number = 5, embedding?: number[]): Promise<MemoryResult[]> {
        if (!this.client) throw new Error('Pinecone client not connected');
        if (!embedding) throw new Error('PineconeProvider requires an embedding for search.');

        const index = this.client.index(this.indexName);
        const results = await index.query({
            vector: embedding,
            topK: limit,
            includeMetadata: true
        });

        return results.matches.map(match => ({
            id: match.id,
            content: (match.metadata?.content as string) || '',
            tags: (match.metadata?.tags as string)?.split(',') || [],
            timestamp: (match.metadata?.timestamp as number) || 0,
            embedding: match.values,
            similarity: match.score,
            sourceProvider: this.id,
            metadata: match.metadata
        }));
    }

    async delete(id: string): Promise<void> {
        if (!this.client) throw new Error('Pinecone client not connected');
        const index = this.client.index(this.indexName);
        await index.deleteOne(id);
    }
}
