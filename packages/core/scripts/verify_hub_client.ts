import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

async function main() {
    const transport = new SSEClientTransport(
        new URL('http://localhost:3000/api/hub/sse')
    );

    const client = new Client({
        name: "Verifier",
        version: "1.0.0"
    }, {
        capabilities: {}
    });

    console.log('Connecting to Hub...');
    await client.connect(transport);
    console.log('Connected.');

    // Start the test server via API (side channel)
    console.log('Starting test-server...');
    await fetch('http://localhost:3000/api/mcp/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test-server' })
    });

    // Wait for server to start and proxy to pick it up
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('Listing tools...');
    const tools = await client.listTools();
    console.log('Tools:', JSON.stringify(tools, null, 2));

    const echoTool = tools.tools.find(t => t.name.includes('echo'));
    if (echoTool) {
        console.log('Calling echo tool...');
        const result = await client.callTool({
            name: echoTool.name,
            arguments: { message: 'Hello Hub!' }
        });
        console.log('Result:', JSON.stringify(result, null, 2));
    } else {
        console.error('Echo tool not found!');
        process.exit(1);
    }

    await client.close();
}

main().catch(console.error);
