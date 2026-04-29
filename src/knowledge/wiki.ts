import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { ktWikiDir } from '../utils/paths.js';

export class WikiStore {
  private dir: string;

  constructor(namespace: string) {
    this.dir = ktWikiDir(namespace);
  }

  private sanitize(key: string): string {
    // Preserve uniqueness: lowercase + replace unsafe chars, keep digits and hyphens
    const base = key.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    // Append short hash to avoid collisions from different source keys
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
    return `${base}-${(hash >>> 0).toString(36)}`;
  }

  get(key: string): any | null {
    try {
      return JSON.parse(readFileSync(join(this.dir, `${this.sanitize(key)}.json`), 'utf-8'));
    } catch { return null; }
  }

  set(key: string, value: any): void {
    mkdirSync(this.dir, { recursive: true });
    const files = this.listKeys();
    if (files.length >= 500) {
      // Evict oldest entries until under cap
      const sorted = files
        .map(f => ({ f, mtime: statSync(join(this.dir, `${f}.json`)).mtimeMs }))
        .sort((a, b) => a.mtime - b.mtime);
      const toRemove = sorted.slice(0, files.length - 499);
      for (const entry of toRemove) {
        try { unlinkSync(join(this.dir, `${entry.f}.json`)); } catch { /* ignore */ }
      }
    }
    writeFileSync(join(this.dir, `${this.sanitize(key)}.json`), JSON.stringify(value));
  }

  search(query: string): Array<{ key: string; value: any }> {
    const q = query.toLowerCase();
    const results: Array<{ key: string; value: any }> = [];
    for (const key of this.listKeys()) {
      try {
        const raw = readFileSync(join(this.dir, `${key}.json`), 'utf-8');
        if (key.includes(q) || raw.toLowerCase().includes(q)) {
          results.push({ key, value: JSON.parse(raw) });
        }
      } catch { /* skip unreadable entries */ }
    }
    return results;
  }

  listKeys(): string[] {
    try {
      return readdirSync(this.dir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
    } catch { return []; }
  }

  cleanup(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}
