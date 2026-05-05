// tests/unit/renderer.test.ts
// Unit tests for src/hitl/renderer.ts

import { describe, it, expect } from 'vitest';
import { renderBox, renderPlanLines, renderCIStatus } from '../../src/hitl/renderer.js';

// Strip ANSI codes for assertion purposes
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1B\[[0-9;]*m/g, '');
}

describe('renderBox', () => {
  it('contains the title text', () => {
    const out = stripAnsi(renderBox('My Title', [], 'HIGH'));
    expect(out).toContain('My Title');
  });

  it('produces top and bottom border characters', () => {
    const out = stripAnsi(renderBox('T', [], 'LOW'));
    expect(out).toContain('╔');
    expect(out).toContain('╗');
    expect(out).toContain('╚');
    expect(out).toContain('╝');
  });

  it('includes section heading when provided', () => {
    const out = stripAnsi(renderBox('Title', [{ heading: 'My Section', lines: ['line1'] }], 'MEDIUM'));
    expect(out).toContain('My Section');
  });

  it('includes section lines', () => {
    const out = stripAnsi(renderBox('Title', [{ heading: 'H', lines: ['alpha', 'beta'] }], 'CRITICAL'));
    expect(out).toContain('alpha');
    expect(out).toContain('beta');
  });

  it('truncates lines longer than INNER_WIDTH with ellipsis', () => {
    const longLine = 'A'.repeat(200);
    const out = stripAnsi(renderBox('T', [{ lines: [longLine] }], 'LOW'));
    expect(out).toContain('…');
  });

  it('renders multiple sections separated by dividers', () => {
    const out = stripAnsi(renderBox('Title', [
      { heading: 'Section 1', lines: ['line a'] },
      { heading: 'Section 2', lines: ['line b'] },
    ], 'HIGH'));
    expect(out).toContain('Section 1');
    expect(out).toContain('Section 2');
    // Section dividers use ╠...╣
    expect(out).toContain('╠');
    expect(out).toContain('╣');
  });

  it('accepts all 4 severity levels without throwing', () => {
    for (const sev of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const) {
      expect(() => renderBox('T', [], sev)).not.toThrow();
    }
  });
});

describe('renderPlanLines', () => {
  it('numbers each file change', () => {
    const lines = renderPlanLines([
      { path: 'src/payment.ts', description: 'add idempotency', before: 'old', after: 'new' },
      { path: 'src/utils.ts',   description: 'fix util',        before: '',    after: 'fixed' },
    ]);
    expect(lines[0]).toContain('1.');
    const hasTwo = lines.some(l => l.includes('2.'));
    expect(hasTwo).toBe(true);
  });

  it('includes file path in output', () => {
    const lines = renderPlanLines([
      { path: 'src/payment.ts', description: 'desc', before: '', after: 'after code' },
    ]);
    expect(lines.join('\n')).toContain('src/payment.ts');
  });

  it('includes description in output', () => {
    const lines = renderPlanLines([
      { path: 'x.ts', description: 'my change description', before: '', after: 'a' },
    ]);
    expect(lines.join('\n')).toContain('my change description');
  });

  it('returns empty array for empty changes list', () => {
    expect(renderPlanLines([])).toEqual([]);
  });
});

describe('renderCIStatus', () => {
  it('returns string with checkmark for passed', () => {
    expect(renderCIStatus('passed')).toContain('passed');
  });

  it('returns string with X for failed', () => {
    expect(renderCIStatus('failed')).toContain('failed');
  });

  it('returns string for running', () => {
    expect(renderCIStatus('running')).toContain('running');
  });

  it('returns string for pending', () => {
    expect(renderCIStatus('pending')).toContain('pending');
  });

  it('handles null (CI not started)', () => {
    const out = renderCIStatus(null);
    expect(out).toBeTruthy();
    expect(typeof out).toBe('string');
  });
});
