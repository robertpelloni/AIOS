import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

export interface Profile {
    name: string;
    description: string;
    active: boolean;
    config: Record<string, any>;
}

export class ProfileManager extends EventEmitter {
    private profilesDir: string;
    private activeProfile: string = 'default';

    constructor(rootDir: string) {
        super();
        this.profilesDir = path.join(rootDir, 'profiles');
        this.ensureDir();
    }

    private ensureDir() {
        if (!fs.existsSync(this.profilesDir)) {
            fs.mkdirSync(this.profilesDir, { recursive: true });
            this.createProfile('default', { description: 'Default configuration' });
        }
    }

    createProfile(name: string, data: Partial<Profile>) {
        const filepath = path.join(this.profilesDir, `${name}.json`);
        const profile: Profile = {
            name,
            description: data.description || '',
            active: name === this.activeProfile,
            config: data.config || {}
        };
        fs.writeFileSync(filepath, JSON.stringify(profile, null, 2));
    }

    getProfiles(): Profile[] {
        if (!fs.existsSync(this.profilesDir)) return [];
        return fs.readdirSync(this.profilesDir)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                try {
                    return JSON.parse(fs.readFileSync(path.join(this.profilesDir, f), 'utf-8'));
                } catch {
                    return null;
                }
            })
            .filter(Boolean) as Profile[];
    }

    setActiveProfile(name: string) {
        const profiles = this.getProfiles();
        if (profiles.find(p => p.name === name)) {
            this.activeProfile = name;
            this.emit('profileChanged', name);
        }
    }

    getActiveProfile(): string {
        return this.activeProfile;
    }
}
