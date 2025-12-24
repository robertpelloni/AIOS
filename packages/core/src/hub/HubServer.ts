import { EventEmitter } from 'events';
import { McpProxyManager } from '../managers/McpProxyManager.js';
import { CodeExecutionManager } from '../managers/CodeExecutionManager.js';

/**
 * HubServer acts as the central brain.
 * It aggregates tools from all connected MCP servers (via ProxyManager)
 * and exposes them to clients (Claude, VSCode) via SSE or Stdio.
 */
export class HubServer extends EventEmitter {
    constructor(
        private proxyManager: McpProxyManager,
        private codeManager: CodeExecutionManager
    ) {
        super();
    }

    /**
     * Handles an incoming JSON-RPC message from a Client (e.g. Claude Desktop)
     * and routes it to the appropriate downstream MCP server or internal handler.
     */
    async handleMessage(sessionId: string, message: any, replyStream?: any) {
        // 1. Log incoming traffic
        // this.emit('traffic', { direction: 'in', message });

        if (message.method === 'tools/list') {
            // Aggregate tools from all running servers
            const tools = await this.proxyManager.getAllTools();
            return {
                jsonrpc: "2.0",
                id: message.id,
                result: { tools }
            };
        }

        if (message.method === 'tools/call') {
            const { name, arguments: args } = message.params;

            // Check if it's a code execution request
            if (name === 'execute_code') {
                const result = await this.codeManager.execute(args.code, async (toolName: string, toolArgs: any) => {
                    return this.proxyManager.callTool(toolName, toolArgs);
                });
                return {
                    jsonrpc: "2.0",
                    id: message.id,
                    result: { content: [{ type: "text", text: result }] }
                };
            }

            // Otherwise route to the correct MCP server
            try {
                const result = await this.proxyManager.callTool(name, args);
                return {
                    jsonrpc: "2.0",
                    id: message.id,
                    result
                };
            } catch (err: any) {
                return {
                    jsonrpc: "2.0",
                    id: message.id,
                    error: { code: -32603, message: err.message }
                };
            }
        }

        // Default: Method not found
        return {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32601, message: "Method not found" }
        };
    }

    async handleSSE(req: any, res: any) {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        const sessionId = Date.now().toString(); // Simple session ID
        console.log(`[Hub] SSE Client Connected: ${sessionId}`);

        // Send initial endpoint URL for the POST transport
        const msg = JSON.stringify({
            event: 'endpoint',
            data: `/api/hub/messages?sessionId=${sessionId}`
        });
        res.write(`event: endpoint\ndata: ${msg}\n\n`);

        // Keep alive
        const interval = setInterval(() => {
            res.write(': keepalive\n\n');
        }, 15000);

        req.on('close', () => {
            console.log(`[Hub] SSE Client Disconnected: ${sessionId}`);
            clearInterval(interval);
        });
    }
}
