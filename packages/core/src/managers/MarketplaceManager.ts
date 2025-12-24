import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

// Mock registry for now - in production this would fetch from a GitHub repo or API
const MOCK_REGISTRY = [
    { name: "coder-agent", type: "agent", description: "An expert coding agent.", url: "https://example.com/coder.json" },
    { name: "writer-skill", type: "skill", description: "Creative writing skill.", url: "https://example.com/writer.md" }
];

export class MarketplaceManager extends EventEmitter {
    private packages: any[] = [];

    constructor(private rootDir: string) {
        super();
    }

    async refresh() {
        // Fetch from remote
        // For now, simulate latency and return mock
        await new Promise(r => setTimeout(r, 500));
        this.packages = MOCK_REGISTRY;
        this.emit('updated', this.packages);
    }

    getPackages() {
        return this.packages;
    }

    async installPackage(name: string) {
        const pkg = this.packages.find(p => p.name === name);
        if (!pkg) throw new Error(`Package ${name} not found`);

        const targetDir = pkg.type === 'agent' ? 'agents' : 'skills';
        const ext = pkg.type === 'agent' ? '.json' : '.skill.md';
        const targetPath = path.join(this.rootDir, targetDir, `${name}${ext}`);

        // Simulate download
        const content = pkg.type === 'agent'
            ? JSON.stringify({ name, description: pkg.description, instructions: "You are an expert." }, null, 2)
            : `# ${name}\n\n${pkg.description}`;

        fs.writeFileSync(targetPath, content);
        return `Installed ${name} to ${targetDir}/`;
    }
}
