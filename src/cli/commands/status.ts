// src/cli/commands/status.ts
// Full implementation in Phase 2 — stub for Phase 1.

import chalk from 'chalk';

export async function showStatus(_opts: { repo?: string; all?: boolean }): Promise<void> {
  console.log(chalk.yellow('\n  vigilant status — available in Phase 2\n'));
}
