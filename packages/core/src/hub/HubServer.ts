import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpProxyManager } from '../managers/McpProxyManager.js';

export class HubServer {
    private server: Server;
    private transports = new Map<string, SSEServerTransport>();

    constructor(private proxyManager: McpProxyManager) {
        this.server = new Server({
            name: "SuperAI-Hub",
            version: "1.0.0"
        }, {
            capabilities: {
                tools: {}
            }
        });

        this.setupHandlers();
    }

    private setupHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            const tools = await this.proxyManager.listTools();
            // Add meta tools
            const metaTools = [
                {
                    name: 'search_tools',
                    description: 'Search available tools',
                    inputSchema: { type: 'object', properties: { query: { type: 'string' } } }
                }
            ];
            return { tools: [...metaTools, ...tools] };
        });

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            if (name === 'search_tools') {
                return { content: [{ type: 'text', text: 'Search not implemented yet' }] };
            }
            return await this.proxyManager.callTool(name, args);
        });
    }

    async handleSSE(req: any, res: any) {
        const transport = new SSEServerTransport('/api/hub/messages', res);
        this.transports.set(transport.sessionId, transport);

        transport.onclose = () => {
            this.transports.delete(transport.sessionId);
        };

        await this.server.connect(transport);
    }

    async handleMessage(sessionId: string, message: any, res: any) {
        const transport = this.transports.get(sessionId);
        if (!transport) {
            res.statusCode = 404;
            res.end('Session not found');
            return;
        }
        // Since Fastify already parsed the body, we can manually inject the message
        // However, SSEServerTransport doesn't expose handleMessage in the public type defs easily in all versions?
        // It extends ServerTransport which usually expects handleMessage.
        // Let's check if we can call it.

        try {
            await transport.handleMessage(message);
            res.statusCode = 200;
            res.end('ok');
        } catch (e: any) {
            console.error('Error handling message:', e);
            res.statusCode = 500;
            res.end(e.message);
        }
    }
}
