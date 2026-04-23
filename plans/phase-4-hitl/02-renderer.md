# Phase 4 — Renderer

**File:** `src/hitl/renderer.ts`

## Objective

Chalk-based terminal box rendering. Every HITL prompt uses the same box style. Width is fixed at 66 characters. Severity drives the border colour.

---

## Implementation

```typescript
// src/hitl/renderer.ts

import chalk from 'chalk';
import type { RendererSection, SeverityColour } from './types';
import type { Severity } from '@/agent/types';

const BOX_WIDTH = 66;

const SEVERITY_COLOUR: Record<Severity, (s: string) => string> = {
  CRITICAL: chalk.red.bold,
  HIGH:     chalk.yellow.bold,
  MEDIUM:   chalk.cyan,
  LOW:      chalk.grey,
};

function colour(severity: Severity): (s: string) => string {
  return SEVERITY_COLOUR[severity];
}

function pad(text: string): string {
  return text.padEnd(BOX_WIDTH - 4); // 4 = '║ ' + ' ║'
}

function hr(char = '═'): string {
  return char.repeat(BOX_WIDTH - 2);
}

/**
 * Renders a box with a title bar and stacked sections separated by dividers.
 *
 * @param title    Text shown in the top bar (e.g. "vigilant  ·  HIGH  ·  SESS_…")
 * @param sections Array of content sections, each rendered with an optional heading
 * @param severity Drives border and title colour
 */
export function renderBox(
  title: string,
  sections: RendererSection[],
  severity: Severity,
): string {
  const c = colour(severity);
  const lines: string[] = [];

  lines.push(c(`╔${hr()}╗`));
  lines.push(c(`║ ${pad(title)} ║`));

  for (const section of sections) {
    lines.push(c(`╠${hr()}╣`));
    if (section.heading) {
      lines.push(c(`║ ${pad(section.heading)} ║`));
    }
    for (const line of section.lines) {
      lines.push(c(`║ ${pad(line)} ║`));
    }
  }

  lines.push(c(`╚${hr()}╝`));
  return lines.join('\n');
}

/**
 * Formats the plan's FileChanges as numbered steps for display inside the box.
 */
export function renderPlanLines(fileChanges: Array<{ path: string; description: string; before: string; after: string }>): string[] {
  const lines: string[] = [];
  fileChanges.forEach((change, i) => {
    lines.push(`${i + 1}. ${change.path}`);
    lines.push(`   ${change.description}`);
    if (change.before) {
      lines.push(`   Before: ${change.before.split('\n')[0]}`);
    }
    lines.push(`   After:  ${change.after.split('\n')[0]}`);
    if (i < fileChanges.length - 1) lines.push('');
  });
  return lines;
}

/**
 * Formats CI status for Gate 2 display.
 * checksTotal = 0 means CI has not run yet.
 */
export function renderCIStatus(ciStatus: string | undefined, checksPassed: number, checksTotal: number): string {
  if (!ciStatus || ciStatus === 'pending') return '⏳ CI running…';
  if (ciStatus === 'success') return `✅ ${checksPassed}/${checksTotal} checks passed`;
  if (ciStatus === 'failure') return `❌ ${checksPassed}/${checksTotal} checks passed`;
  return ciStatus;
}
```
