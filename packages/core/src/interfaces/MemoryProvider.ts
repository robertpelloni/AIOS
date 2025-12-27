export interface MemoryItem {
    id: string;
    content: string;
    tags: string[];
    timestamp: number;
    embedding?: number[];
    metadata?: Record<string, any>;
}

export interface MemoryResult extends MemoryItem {
    similarity?: number;
    sourceProvider: string;
}

export interface MemoryProvider {
    id: string;
    name: string;
    type: 'vector' | 'graph' | 'key-value' | 'file' | 'external';
    capabilities: ('read' | 'write' | 'search' | 'delete')[];
    
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    
    insert(item: MemoryItem): Promise<string>;
    search(query: string, limit?: number, embedding?: number[]): Promise<MemoryResult[]>;
    delete(id: string): Promise<void>;
    
    // Optional: For sync/transfer
    getAll?(): Promise<MemoryItem[]>;
    import?(items: MemoryItem[]): Promise<void>;
}
