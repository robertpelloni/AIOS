import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

export interface Profile {
    name: string;
    description: string;
    activeAgents: string[];
    activeSkills: string[];
    activeContexts: string[];
    envVars?: Record<string, string>;
}

export class ProfileManager extends EventEmitter {
    private profiles: Map<string, Profile> = new Map();
    private activeProfile: Profile | null = null;
    private profilesDir: string;

    constructor(rootDir: string) {
        super();
        this.profilesDir = path.join(rootDir, 'profiles');
        this.ensureDir();
        this.loadProfiles();
    }

    private ensureDir() {
        if (!fs.existsSync(this.profilesDir)) {
            fs.mkdirSync(this.profilesDir, { recursive: true });
            // Create default profile
            this.saveProfile({
                name: 'default',
                description: 'Default profile with all tools enabled',
                activeAgents: ['*'],
                activeSkills: ['*'],
                activeContexts: ['*']
            });
        }
    }

    private loadProfiles() {
        try {
            const files = fs.readdirSync(this.profilesDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const content = fs.readFileSync(path.join(this.profilesDir, file), 'utf-8');
                    const profile: Profile = JSON.parse(content);
                    this.profiles.set(profile.name, profile);
                }
            }
            console.log(`[ProfileManager] Loaded ${this.profiles.size} profiles`);
        } catch (e) {
            console.error('[ProfileManager] Error loading profiles:', e);
        }
    }

    saveProfile(profile: Profile) {
        const filepath = path.join(this.profilesDir, `${profile.name}.json`);
        fs.writeFileSync(filepath, JSON.stringify(profile, null, 2));
        this.profiles.set(profile.name, profile);
        this.emit('updated', this.getProfiles());
    }

    getProfiles() {
        return Array.from(this.profiles.values());
    }

    activateProfile(name: string): Profile | null {
        const profile = this.profiles.get(name);
        if (profile) {
            this.activeProfile = profile;
            console.log(`[ProfileManager] Activated profile: ${name}`);
            this.emit('activated', profile);
            return profile;
        }
        return null;
    }

    getActiveProfile() {
        return this.activeProfile;
    }
}
