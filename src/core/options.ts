export interface CommandOptions {
  mode: 'repo' | 'global';
  cwd: string;
  home: string;
  dryRun: boolean;
  force: boolean;
  hook: boolean;
  symlink: boolean;
  /** Which of hook/symlink were set by an explicit flag (update reuses recorded values otherwise). */
  explicit?: { hook: boolean; symlink: boolean };
}
