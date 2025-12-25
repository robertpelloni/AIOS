import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

export interface TrafficLog {
    id: string;
    timestamp: number;
    type: 'request' | 'response' | 'error';
    tool?: string;
    server?: string;
    args?: any;
    result?: any;
    error?: any;
    cost?: number;
    tokens?: number;
}

export class LogManager extends EventEmitter {
    private logFile: string;

    constructor(logDir?: string) {
        super();
        const dir = logDir || path.join(process.cwd(), 'logs');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.logFile = path.join(dir, 'traffic.jsonl');
    }

    public log(entry: Omit<TrafficLog, 'id' | 'timestamp'>) {
        const fullEntry: TrafficLog = {
            id: Math.random().toString(36).substring(7),
            timestamp: Date.now(),
            ...entry
        };
        
        // Emit to subscribers (Socket.io)
        this.emit('log', fullEntry);

        // Persist to file
        this.appendLog(fullEntry);
    }

    private appendLog(entry: TrafficLog) {
        try {
            fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
        } catch (e) {
            console.error('[LogManager] Failed to write log:', e);
        }
    }

    public async getLogs(filter: { 
        limit?: number, 
        type?: string, 
        tool?: string,
        startTime?: number,
        endTime?: number
    } = {}): Promise<TrafficLog[]> {
        const logs: TrafficLog[] = [];
        if (!fs.existsSync(this.logFile)) return [];

        // Read file line by line (or all at once for simplicity in this version)
        // For large files, we should use a stream or readLastLines
        try {
            const content = fs.readFileSync(this.logFile, 'utf-8');
            const lines = content.split('\n').filter(l => l.trim());
            
            // Process in reverse for "most recent first"
            for (let i = lines.length - 1; i >= 0; i--) {
                try {
                    const log = JSON.parse(lines[i]);
                    
                    if (filter.type && log.type !== filter.type) continue;
                    if (filter.tool && log.tool !== filter.tool) continue;
                    if (filter.startTime && log.timestamp < filter.startTime) continue;
                    if (filter.endTime && log.timestamp > filter.endTime) continue;

                    logs.push(log);
                    
                    if (filter.limit && logs.length >= filter.limit) break;
                } catch (e) {
                    // Skip malformed lines
                }
            }
        } catch (e) {
            console.error('[LogManager] Failed to read logs:', e);
        }

        return logs;
    }

    public calculateCost(model: string, inputTokens: number, outputTokens: number): number {
        // Placeholder pricing (approximate)
        const prices: Record<string, { in: number, out: number }> = {
            'gpt-4-turbo': { in: 0.01, out: 0.03 }, // per 1k
            'gpt-3.5-turbo': { in: 0.0005, out: 0.0015 },
            'claude-3-opus': { in: 0.015, out: 0.075 },
            'claude-3-sonnet': { in: 0.003, out: 0.015 }
        };

        const price = prices[model] || prices['gpt-3.5-turbo'];
        return (inputTokens / 1000 * price.in) + (outputTokens / 1000 * price.out);
    }
}
