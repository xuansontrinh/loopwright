import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentRoot } from '../src/core/content.js';

const rules = () => readFileSync(join(contentRoot(), 'prompts/user-messages.md'), 'utf8');

function glossary(): string {
  const lines = rules().split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s*glossary\b/i.test(l));
  if (start < 0) return '';
  const depth = lines[start]!.match(/^#+/)![0].length;
  const end = lines.findIndex((l, i) => i > start && /^#{1,6}\s/.test(l) && l.match(/^#+/)![0].length <= depth);
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

describe('user messages rules file', () => {
  it.each([
    ['puts the outcome or decision first', /(outcome|decision)[^\n]{0,30}first/i],
    [
      'writes for a reader who has not seen the code, tool output or task file',
      /(not|n't) seen[^\n]{0,120}code[^\n]{0,120}task file/i,
    ],
    [
      'gives the plain description first and the term or code name in brackets after',
      /plain[\s\S]{0,200}first[\s\S]{0,200}brackets?[\s\S]{0,100}after/i,
    ],
    ['says what each finding or trade-off means for the user', /means for the user/i],
    ['keeps one idea per sentence', /one idea per sentence/i],
    ['uses active voice and names who acts', /active voice|who acts/i],
    ['uses the same word for the same thing', /same word for the same thing/i],
    ['has decision questions give a recommendation with a reason', /recommend[^\n]{0,60}reason/i],
    ['has decision questions say what each option does', /each option[^\n]{0,80}(what|happens|does)/i],
    ['gives one concrete example for a trade-off', /one concrete example/i],
    ['gives the short answer first and details on request', /short answer first[\s\S]{0,200}on request/i],
    [
      'uses literal words, without simply, just or easy',
      /literal(?=[\s\S]{0,300}simply)(?=[\s\S]{0,300}\bjust\b)(?=[\s\S]{0,300}\beasy\b)/i,
    ],
    ['ends a step with a stand-alone recap', /stand-?alone recap/i],
  ])('%s', (_name, pattern) => {
    expect(rules()).toMatch(pattern);
  });

  it('sets a soft 15 to 20 word target for a sentence', () => {
    expect(rules()).toMatch(/15\s*[–-]\s*20/);
    expect(rules()).toMatch(/soft/i);
  });

  it('gives a why for each of the 12 rules', () => {
    expect((rules().match(/\bWhy:/g) ?? []).length).toBeGreaterThanOrEqual(12);
  });

  it('shows at least 2 before and after examples', () => {
    const pairs = rules().match(/\bBefore[*_`]*:[\s\S]{0,600}?\bAfter[*_`]*:/g) ?? [];
    expect(pairs.length).toBeGreaterThanOrEqual(2);
  });
});

describe('user messages glossary', () => {
  it('has a glossary section', () => {
    expect(glossary()).not.toBe('');
  });

  it.each([
    ['task ids', /task ids?/i],
    ['acceptance criterion', /acceptance criteri(on|a)/i],
    ['acceptance test', /acceptance tests?/i],
    ['lock', /(^|[^-\w])lock\b/i],
    ['re-lock', /re-?lock/i],
    ['tier', /\btier\b/i],
    ['profile', /\bprofile\b/i],
    ['slice', /\bslice\b/i],
    ['stop gate', /stop gate/i],
    ['fix round', /fix round/i],
    ['two-pass review', /two-pass/i],
    ['undecided finding', /undecided finding/i],
    ['deviation', /deviation/i],
    ['simplify cut', /simplify cut/i],
    ['worktree', /worktree/i],
    ['base commit', /base commit/i],
  ])('explains %s in a plain-words entry', (_term, pattern) => {
    const entry = glossary()
      .split('\n')
      .find((l) => l.split(/\s+/).length >= 6 && pattern.test(l.slice(0, 60)));
    expect(entry).toBeDefined();
  });
});
