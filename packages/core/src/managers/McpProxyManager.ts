import { McpManager } from './McpManager.js';
import { LogManager } from './LogManager.js';

export class McpProxyManager {
    constructor(
        private mcpManager: McpManager,
        private logManager: LogManager
    ) {}

    async getAllTools() {
        // In a real implementation, we would query `tools/list` from every running server
        // via mcpManager.getClient(name).listTools()
        // For now, we will just return a mocked list + any running servers' tools if possible

        const tools = [];
        const servers = this.mcpManager.getAllServers();

        for (const s of servers) {
            if (s.status === 'running') {
                const client = this.mcpManager.getClient(s.name);
                if (client) {
                    try {
                        const result = await client.listTools();
                        // Namespace the tools? e.g. "serverName__toolName"
                        // Or just merge them (risk of collision)
                        // For Super AI Plugin, we likely want namespacing or intelligent routing.
                        // Let's just map them as is for now.
                        tools.push(...result.tools);
                    } catch (e) {
                        console.error(`Failed to list tools from ${s.name}`, e);
                    }
                }
            }
        }

        return tools;
    }

    async callTool(name: string, args: any) {
        // We need to find which server has this tool.
        // This is inefficient (querying all), so we should cache the tool map.
        // For this skeleton, we'll linear search.

        const servers = this.mcpManager.getAllServers();
        for (const s of servers) {
            if (s.status === 'running') {
                const client = this.mcpManager.getClient(s.name);
                if (client) {
                    try {
                        const list = await client.listTools();
                        if (list.tools.find((t: any) => t.name === name)) {
                            // Found the server! Call it.
                            this.logManager.log({ type: 'request', tool: name, server: s.name, args });
                            const result = await client.callTool({ name, arguments: args });
                            this.logManager.log({ type: 'response', tool: name, server: s.name, result });
                            return result;
                        }
                    } catch (e) {
                        // ignore
                    }
                }
            }
        }
        throw new Error(`Tool ${name} not found in any active server.`);
    }
}
