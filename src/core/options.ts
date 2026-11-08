export interface CommandOptions {
  mode: 'repo' | 'global';
  cwd: string;
  home: string;
  dryRun: boolean;
  force: boolean;
  hook: boolean;
  symlink: boolean;
}
