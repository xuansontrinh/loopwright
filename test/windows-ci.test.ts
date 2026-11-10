import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('AC14: Windows CI and portable tests', () => {
  it('AC14: .gitattributes forces LF', () => {
    expect(read('.gitattributes')).toMatch(/^\*\s+text=auto\s+eol=lf\s*$/m);
  });

  it('AC14: ci.yml has an os matrix with windows continue-on-error', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toMatch(/os:\s*\[[^\]]*ubuntu-latest[^\]]*windows-latest[^\]]*\]|windows-latest/);
    expect(ci).toContain('windows-latest');
    expect(ci).toMatch(/runs-on:\s*\$\{\{\s*matrix\.os\s*\}\}/);
    expect(ci).toMatch(/continue-on-error:.*windows/);
  });

  it('AC14: content.test.ts uses fileURLToPath, not URL.pathname', () => {
    const s = read('test/content.test.ts');
    expect(s).toContain('fileURLToPath');
    expect(s).not.toMatch(/new URL\([^)]*\)\.pathname/);
  });

  it('AC14: mkfifo test is skipped on win32', () => {
    const s = read('test/hooks/lw.test.ts');
    const i = s.indexOf('mkfifo');
    expect(i).toBeGreaterThan(-1);
    const before = s.slice(Math.max(0, s.lastIndexOf('\n  it', i) - 200), i);
    expect(before).toMatch(/win32/);
  });

  it.each(['test/hooks/enforcement.test.ts', 'test/hooks/junie-enforcement.test.ts'])(
    'AC14: %s escapes payload paths via JSON.stringify, not raw string replace',
    (f) => {
      expect(read(f)).not.toContain(".split('/REPO').join(repo)");
    },
  );
});
