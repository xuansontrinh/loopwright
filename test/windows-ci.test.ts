import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('Windows CI and portable tests', () => {
  it('.gitattributes forces LF', () => {
    expect(read('.gitattributes')).toMatch(/^\*\s+text=auto\s+eol=lf\s*$/m);
  });

  it('ci.yml has an os matrix including windows-latest', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('windows-latest');
    expect(ci).toMatch(/runs-on:\s*\$\{\{\s*matrix\.os\s*\}\}/);
  });

  it('ci.yml has no continue-on-error, so the Windows job is required', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).not.toMatch(/continue-on-error/);
  });

  it('content.test.ts uses fileURLToPath, not URL.pathname', () => {
    const s = read('test/content.test.ts');
    expect(s).toContain('fileURLToPath');
    expect(s).not.toMatch(/new URL\([^)]*\)\.pathname/);
  });

  it('mkfifo test is skipped on win32', () => {
    const s = read('test/hooks/lw.test.ts');
    const i = s.indexOf('mkfifo');
    expect(i).toBeGreaterThan(-1);
    const before = s.slice(Math.max(0, s.lastIndexOf('\n  it', i) - 200), i);
    expect(before).toMatch(/win32/);
  });

  it.each(['test/hooks/enforcement.test.ts', 'test/hooks/junie-enforcement.test.ts'])(
    '%s escapes payload paths via JSON.stringify, not raw string replace',
    (f) => {
      expect(read(f)).not.toContain(".split('/REPO').join(repo)");
    },
  );
});
