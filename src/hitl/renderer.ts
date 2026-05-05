// src/hitl/renderer.ts
// Chalk-based terminal box rendering used by Gate 1 and Gate 2 prompts.
// Width is fixed at 66 characters. Severity drives the border colour.

import chalk from 'chalk';
import type { RendererSection } from './types.js';
import type { IssueSeverity, CIStatus } from '../agent/types.js';

const BOX_WIDTH = 66;
const INNER_WIDTH = BOX_WIDTH - 4; // '║ ' + ' ║'

const SEVERITY_COLOUR: Record<IssueSeverity, (s: string) => string> = {
  CRITICAL: chalk.red.bold,
  HIGH:     chalk.yellow.bold,
  MEDIUM:   chalk.cyan,
  LOW:      chalk.grey,
};

function colourFn(severity: IssueSeverity): (s: string) => string {
  return SEVERITY_COLOUR[severity];
}

function pad(text: string): string {
  if (text.length > INNER_WIDTH) {
    return text.slice(0, INNER_WIDTH - 1) + '…';
  }
  return text.padEnd(INNER_WIDTH);
}

function hr(char = '═'): string {
  return char.repeat(BOX_WIDTH - 2);
}

/**
 * Renders a styled terminal box with a title bar and stacked sections.
 * Content lines are plain text — the severity colour wraps the box borders.
 */
export function renderBox(
  title:    string,
  sections: RendererSection[],
  severity: IssueSeverity,
): string {
  const c     = colourFn(severity);
  const lines: string[] = [];

  lines.push(c(`╔${hr()}╗`));
  lines.push(c(`║ `) + pad(title) + c(` ║`));

  for (const section of sections) {
    lines.push(c(`╠${hr()}╣`));
    if (section.heading) {
      lines.push(c(`║ `) + chalk.bold(pad(section.heading)) + c(` ║`));
    }
    for (const line of section.lines) {
      lines.push(c(`║ `) + pad(line) + c(` ║`));
    }
  }

  lines.push(c(`╚${hr()}╝`));
  return lines.join('\n');
}

/**
 * Formats a Plan's file changes as numbered steps for display inside the box.
 */
export function renderPlanLines(changes: Array<{
  path:        string;
  description: string;
  before:      string;
  after:       string;
}>): string[] {
  const lines: string[] = [];
  changes.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.path}`);
    lines.push(`   ${c.description}`);
    if (c.before) {
      lines.push(`   Before: ${c.before.split('\n')[0].trim().slice(0, 52)}`);
    }
    lines.push(`   After:  ${c.after.split('\n')[0].trim().slice(0, 53)}`);
    if (i < changes.length - 1) lines.push('');
  });
  return lines;
}

/** Render a CIStatus into a short human-readable string with an emoji. */
export function renderCIStatus(status: CIStatus): string {
  switch (status) {
    case 'passed':  return '✅ passed';
    case 'failed':  return '❌ failed';
    case 'running': return '🔄 running';
    case 'pending': return '⏳ pending';
    default:        return '— not started';
  }
}
