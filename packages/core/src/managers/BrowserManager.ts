import { EventEmitter } from 'events';
import { Socket } from 'socket.io';

export class BrowserManager extends EventEmitter {
    private clients: Map<string, Socket> = new Map();

    constructor() {
        super();
    }

    registerClient(socket: Socket) {
        this.clients.set(socket.id, socket);
        console.log(`[BrowserManager] Client registered: ${socket.id}`);

        socket.on('disconnect', () => {
            this.clients.delete(socket.id);
        });
    }

    getToolDefinitions() {
        return [
            {
                name: "read_active_tab",
                description: "Read the content (text, title, url) of the currently active tab in the connected browser.",
                inputSchema: { type: "object", properties: {} }
            },
            {
                name: "browser_navigate",
                description: "Navigate the browser to a specific URL.",
                inputSchema: {
                    type: "object",
                    properties: {
                        url: { type: "string" }
                    },
                    required: ["url"]
                }
            },
            {
                name: "inject_context",
                description: "Inject (type/paste) text into the active input field of the active browser tab.",
                inputSchema: {
                    type: "object",
                    properties: {
                        text: { type: "string" }
                    },
                    required: ["text"]
                }
            }
        ];
    }

    async readActiveTab() {
        const socket = this.clients.values().next().value;
        if (!socket) throw new Error("No browser connected.");

        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error("Browser request timed out")), 5000);

            socket.emit('browser:read_page', { requestId: Date.now() }, (response: any) => {
                clearTimeout(t);
                resolve(response);
            });
        });
    }

    async navigate(url: string) {
        const socket = this.clients.values().next().value;
        if (!socket) throw new Error("No browser connected.");

        socket.emit('browser:navigate', { url });
        return `Navigating to ${url}`;
    }

    async injectContext(text: string) {
        const socket = this.clients.values().next().value;
        if (!socket) throw new Error("No browser connected.");

        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error("Browser request timed out")), 5000);

            socket.emit('browser:inject_text', { text, requestId: Date.now() }, (response: any) => {
                clearTimeout(t);
                resolve(response);
            });
        });
    }
}
