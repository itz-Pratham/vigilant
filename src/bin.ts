#!/usr/bin/env node
// src/bin.ts — entry point for the vigilant CLI

import 'dotenv/config';
import { program } from './cli/index.js';

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`\nError: ${message}\n`);
  process.exit(1);
});
