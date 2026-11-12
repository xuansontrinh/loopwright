import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const file = join(__dirname, '..', '.github', 'workflows', 'format.yml');
const yml = () => readFileSync(file, 'utf8');
const lines = () => yml().split('\n');

describe('format workflow', () => {
  it('triggers only on pull_request opened, synchronize, reopened', () => {
    const t = yml();
    expect(t).toMatch(/^on:\s*\n\s+pull_request:\s*\n\s+types:\s*\[\s*opened,\s*synchronize,\s*reopened\s*\]/m);
    expect(t).not.toContain('pull_request_target:');
    expect(t).not.toMatch(/^\s+push:/m);
    expect(t).not.toMatch(/^\s+workflow_dispatch:/m);
  });

  it('runs only for same-repo, non-Dependabot pull requests', () => {
    const t = yml();
    expect(t).toMatch(/if:[^\n]*github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/);
    expect(t).toMatch(/if:[\s\S]*dependabot\[bot\]/);
    expect(t).toMatch(/!=\s*'dependabot\[bot\]'/);
  });

  it('grants only contents read and no write scope', () => {
    const t = yml();
    expect(t).toMatch(/^permissions:\s*\n\s+contents:\s*read\s*$/m);
    expect(t).not.toMatch(/:\s*write\b/);
    const perms = lines().filter((l) =>
      /^\s+(contents|pull-requests|actions|issues|checks|packages|id-token):/.test(l),
    );
    expect(perms.length).toBe(1);
  });

  it('pins every action to a SHA with a version comment and installs without scripts', () => {
    const uses = lines().filter((l) => /^\s*-?\s*uses:/.test(l));
    expect(uses.length).toBeGreaterThanOrEqual(2);
    for (const l of uses) {
      expect(l).toMatch(/uses:\s*[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v\d/);
    }
    expect(yml()).toMatch(
      /actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\s*\n(?:\s+[^\n]*\n)*?\s+persist-credentials:\s*false/,
    );
    expect(yml()).toContain('npm ci --ignore-scripts');
  });

  it('formats, commits only on diff, and pushes with the secret token', () => {
    const t = yml();
    expect(t).toContain('npm run format');
    expect(t).not.toMatch(/npm run format:check/);
    expect(t).toMatch(/git diff/);
    expect(t).toContain('style: run prettier');
    expect(t).toContain('secrets.FORMAT_PUSH_TOKEN');
    expect(t).toMatch(/git push/);
    expect(t).toContain('github.event.pull_request.head.ref');
    expect(t).toContain('github-actions[bot]');
  });

  it('warns and skips the push without failing when the token is missing', () => {
    const t = yml();
    expect(t).toContain('::warning::');
    expect(t).toMatch(/-z\s+"?\$\{?\w*(TOKEN|PUSH)\w*\}?"?|\[\s+-n\s+"?\$\{?\w*(TOKEN|PUSH)\w*\}?"?/);
    expect(t).toMatch(/exit 0/);
  });

  it('cancels in-progress runs per pull request number', () => {
    const t = yml();
    expect(t).toMatch(/concurrency:\s*\n\s+group:[^\n]*github\.event\.pull_request\.number/);
    expect(t).toMatch(/cancel-in-progress:\s*true/);
  });
});
