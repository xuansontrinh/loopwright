#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { CommandOptions } from './core/options.js';
import { runInit } from './commands/init.js';
import { runUpdate } from './commands/update.js';
import { runUninstall } from './commands/uninstall.js';

const HELP = `loopwright - agent workflow installer for Claude Code and Codex

Usage:
  loopwright init        Install the workflow into the current repo (or globally)
  loopwright update      Refresh installed files to the current version
                         (reuses init's --no-hook/--no-symlink unless passed again)
  loopwright uninstall   Remove installed files

Options:
  --global        Install into the user home instead of the current repo
  --no-hook       Skip hook wiring
  --no-symlink    Skip the .claude/skills symlink
  --dry-run       Show what would change without writing
  --force         Overwrite conflicting files without prompting
  -v, --version   Print version
  -h, --help      Show this help
`;

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return pkg.version as string;
}

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        global: { type: 'boolean', default: false },
        'no-hook': { type: 'boolean', default: false },
        'no-symlink': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        version: { type: 'boolean', short: 'v', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    console.error((err as Error).message);
    return 1;
  }
  const { values, positionals } = parsed;

  if (values.version) {
    console.log(readVersion());
    return 0;
  }
  const command = positionals[0];
  if (values.help || !command) {
    console.log(HELP);
    return 0;
  }

  const opts: CommandOptions = {
    mode: values.global ? 'global' : 'repo',
    cwd: process.cwd(),
    home: homedir(),
    dryRun: values['dry-run'],
    force: values.force,
    hook: !values['no-hook'],
    symlink: !values['no-symlink'],
    explicit: { hook: values['no-hook'], symlink: values['no-symlink'] },
  };

  switch (command) {
    case 'init':
      return runInit(opts);
    case 'update':
      return runUpdate(opts);
    case 'uninstall':
      return runUninstall(opts);
    default:
      console.error(`Unknown command: ${command}\n\n${HELP}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
