import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';
import { createTempGitRepo, runCli } from './helpers.js';

const read = (rel: string) => readFileSync(contentRoot() + rel, 'utf8');
const skill = (name: string) => read(`skills/loopwright-${name}/SKILL.md`);
const section = (body: string, heading: RegExp) => {
  const parts = body.split(/^(?=## )/m);
  return parts.find((p) => heading.test(p.split('\n')[0]!)) ?? '';
};

describe('explore skill', () => {
  it('exists with a spec-valid name and a real description', () => {
    expect(existsSync(contentRoot() + 'skills/loopwright-explore/SKILL.md')).toBe(true);
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(skill('explore'))![1]!;
    expect(fm).toMatch(/^name: loopwright-explore$/m);
    const desc = /^description: (.*)$/m.exec(fm)![1]!;
    expect(desc.length).toBeGreaterThan(40);
    expect(desc).not.toContain(': ');
  });

  it('has the standard setup and uses lw.mjs explore', () => {
    const body = skill('explore');
    const setup = section(body, /^## Setup/);
    expect(setup).toContain('git rev-parse --show-toplevel');
    expect(setup).toContain('node "{{LW_HOME}}/hooks/lw.mjs" dir');
    expect(setup).toContain('`null` inside a git repo');
    expect(setup).toContain('creates `.loopwright/`');
    expect(setup).toContain('Not a git repo → tell the user loopwright must run inside a git repo');
    expect(body).toContain('lw.mjs" explore');
    expect(body).toContain('--new');
  });

  it('gates the outline and uses one scout per component', () => {
    const body = skill('explore');
    expect(body).toMatch(/outline/i);
    expect(body).toMatch(/confirm/i);
    expect(body).toMatch(/one (read-only )?scout per component/i);
    expect(body).toContain('spawn the');
  });

  it('builds a claim list with path:line and gives the checker only that list', () => {
    const body = skill('explore');
    expect(body).toMatch(/claim list/i);
    expect(body).toContain('path:line');
    expect(body).toMatch(/only the claim list|claim list only/i);
    expect(body).toMatch(/unconfirmed/);
    expect(body).toMatch(/dashed/i);
    expect(body).toMatch(/remove/i);
  });

  it('never edits code, runs no repo commands, resumes from disk, and withholds the copy offer mid-task', () => {
    const body = skill('explore');
    expect(body).toMatch(/never (edit|edits|change|changes)[^\n]*(code|source)/i);
    expect(body).toMatch(/no repo commands|not run|never run|do not run/i);
    expect(body).toMatch(/on disk|files on disk/i);
    expect(body).toMatch(/copy/i);
    expect(body).toMatch(/test[^\n]*build[^\n]*review|`test`[^\n]*`build`[^\n]*`review`/);
  });

  it('lists the 12 walkthrough sections in order', () => {
    const body = skill('explore');
    const titles = [
      'Header',
      'What this is',
      'Words you will meet',
      'The system and its surroundings',
      'The big pieces',
      'How a request moves through it',
      'Components',
      'How things are done everywhere',
      'Running it locally',
      'A tour of the code',
      'Questions for the team',
      'Evidence',
    ];
    let at = -1;
    for (const t of titles) {
      const i = body.indexOf(t, at + 1);
      expect(i, t).toBeGreaterThan(at);
      at = i;
    }
  });

  it('states the diagram rules', () => {
    const body = skill('explore');
    expect(body).toMatch(/title/i);
    expect(body).toMatch(/legend/i);
    expect(body).toMatch(/verb/i);
    expect(body).toMatch(/\b8\b/);
    expect(body).toMatch(/mermaid/i);
  });

  it('flow names loopwright-explore', () => {
    expect(skill('flow')).toContain('loopwright-explore');
  });
});

describe('scout explore tasks', () => {
  const scout = () => read('agents/scout.md');

  it('has an Explore tasks section with map, component and check modes', () => {
    const sec = section(scout(), /^## Explore tasks/);
    expect(sec).not.toBe('');
    expect(sec).toMatch(/map/i);
    expect(sec).toMatch(/component/i);
    expect(sec).toMatch(/check/i);
    expect(sec).toContain('path:line');
  });

  it('bans repo commands in explore mode', () => {
    const sec = section(scout(), /^## Explore tasks/);
    expect(sec).toMatch(/no repo commands|do not run (any )?repo|never run/i);
  });

  it('description is not limited to the Plan stage', () => {
    const desc = /^description: (.*)$/m.exec(scout())![1]!;
    expect(desc).not.toMatch(/for the Plan stage/i);
    expect(desc).toMatch(/explor/i);
  });
});

describe('explore install', () => {
  it('init installs the explore skill into a temp repo', () => {
    const repo = createTempGitRepo('lw-explore-');
    const r = runCli(repo, ['init']);
    expect(r.exitCode, r.stderr).toBe(0);
    for (const base of ['.agents/skills', '.claude/skills']) {
      const p = join(repo, base, 'loopwright-explore', 'SKILL.md');
      expect(existsSync(p), p).toBe(true);
      expect(readFileSync(p, 'utf8')).not.toContain('{{');
    }
  });
});
