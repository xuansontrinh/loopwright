export interface CommandOptions {
  mode: 'repo' | 'global';
  cwd: string;
  home: string;
  dryRun: boolean;
  force: boolean;
  hook: boolean;
  symlink: boolean;
  /** Enabled experimental feature names (explicit, `all` already expanded). */
  experimental?: string[];
  /** Effort profile name from --profile (update reuses the recorded one). */
  profile?: string;
  /** Which of hook/symlink were set by an explicit flag (update reuses recorded values otherwise). */
  explicit?: { hook: boolean; symlink: boolean; experimental?: boolean; profile?: boolean };
}
