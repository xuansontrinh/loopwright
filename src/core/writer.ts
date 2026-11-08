import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { sha256, type Manifest } from './manifest.js';

export type WriteOutcome = 'created' | 'updated' | 'unchanged' | 'kept';

export interface InstallWriterOptions {
  manifest: Manifest | null;
  dryRun: boolean;
  force: boolean;
  confirm: (q: string) => Promise<boolean>;
  toKey: (abs: string) => string;
  mode?: Manifest['mode'];
}

type ConfigEntry = Manifest['config'][number];

export class InstallWriter {
  private readonly recorded = new Map<string, string>();
  private readonly config: ConfigEntry[] = [];

  constructor(private readonly opts: InstallWriterOptions) {}

  async writeFile(abs: string, content: string): Promise<WriteOutcome> {
    const key = this.opts.toKey(abs);
    const newHash = sha256(content);

    if (!existsSync(abs)) {
      this.write(abs, content);
      this.recorded.set(key, newHash);
      return 'created';
    }

    const current = readFileSync(abs, 'utf-8');
    const currentHash = sha256(current);
    if (current === content) {
      this.recorded.set(key, currentHash);
      return 'unchanged';
    }

    const prior = this.opts.manifest?.files.find((f) => f.path === key)?.sha256;
    let overwrite = prior !== undefined && prior === currentHash;
    if (!overwrite) {
      if (this.opts.force) overwrite = true;
      else if (this.opts.dryRun) overwrite = false;
      else overwrite = await this.opts.confirm(`${abs} was modified. Overwrite?`);
    }

    if (overwrite) {
      this.write(abs, content);
      this.recorded.set(key, newHash);
      return 'updated';
    }
    // Declined: never claim the user's content as ours. Keep the prior hash, or no entry at all.
    if (prior !== undefined) this.recorded.set(key, prior);
    return 'kept';
  }

  recordConfig(entry: ConfigEntry): void {
    this.addConfig(entry);
  }

  /** Hooks skipped this run: existing wiring stays in place, so its manifest record must too. */
  carryPriorConfig(): void {
    for (const c of this.opts.manifest?.config ?? []) this.addConfig(c);
  }

  private addConfig(entry: ConfigEntry): void {
    if (!this.config.some((c) => c.file === entry.file && c.kind === entry.kind)) {
      this.config.push({ file: entry.file, kind: entry.kind });
    }
  }

  result(): Manifest {
    const files = [...this.recorded.entries()]
      .map(([path, hash]) => ({ path, sha256: hash }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return {
      version: 1,
      mode: this.opts.mode ?? this.opts.manifest?.mode ?? 'repo',
      files,
      config: [...this.config],
    };
  }

  private write(abs: string, content: string): void {
    if (this.opts.dryRun) return;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf-8');
  }
}
