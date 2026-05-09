// src/agent/seed-loader.ts
// Loads domain knowledge seed files into the RAG knowledge base on first startup.
// Each .md file in knowledge/{domain}/ is stored as one knowledge document.
// Idempotent — uses source_url dedup so re-running never creates duplicates.

import { readdirSync, readFileSync } from 'fs';
import { join }                      from 'path';
import { randomUUID }                from 'crypto';
import { addKnowledgeDocument, documentExistsByUrl } from '../db/queries/knowledge.js';
import type { DomainPack }           from './domain-context.js';
import { info, warn, debug }         from '../lib/logger.js';

/**
 * Loads all seed .md files from pack.knowledgeSeedDir into the knowledge base.
 * Returns the number of new documents actually inserted (0 if all already loaded).
 */
export function loadDomainSeeds(pack: DomainPack): number {
  if (!pack.knowledgeSeedDir) return 0;

  let dir: string;
  try {
    dir = pack.knowledgeSeedDir;
    readdirSync(dir);  // validate directory is accessible
  } catch {
    warn(`[seed-loader] Seed directory not found for pack "${pack.id}": ${pack.knowledgeSeedDir}`, '[seed-loader]');
    return 0;
  }

  const files = readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort();

  if (files.length === 0) {
    debug(`[seed-loader] No .md files in ${dir}`, '[seed-loader]');
    return 0;
  }

  let added = 0;
  for (const file of files) {
    const filePath = join(dir, file);
    // Use a stable file:// URL as the dedup key
    const sourceUrl = `file://${filePath}`;

    if (documentExistsByUrl(sourceUrl)) continue;

    const content = readFileSync(filePath, 'utf-8');
    const title   = extractTitle(content, file);
    const topic   = file.replace(/^\d+-/, '').replace(/\.md$/, '').replace(/-/g, ' ');

    const inserted = addKnowledgeDocument({
      id:         randomUUID(),
      scope:      'global',
      domain:     pack.id,
      topic,
      sourceUrl,
      sourceType: 'codebase',
      title,
      content,
      keyPoints:  [],
      confidence: 1.0,
      learnedAt:  new Date().toISOString(),
      createdAt:  new Date().toISOString(),
    });

    if (inserted) added++;
  }

  if (added > 0) {
    info(`[seed-loader] Loaded ${added} seed document(s) for pack "${pack.id}"`, '[seed-loader]');
  }

  return added;
}

/**
 * Loads seeds for all provided packs. Returns total documents inserted.
 */
export function loadAllDomainSeeds(packs: DomainPack[]): number {
  return packs.reduce((total, pack) => total + loadDomainSeeds(pack), 0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract the first # heading from markdown, or fall back to filename. */
function extractTitle(content: string, filename: string): string {
  const match = content.match(/^#\s+(.+)/m);
  if (match) return match[1].trim();
  return filename.replace(/^\d+-/, '').replace(/\.md$/, '').replace(/-/g, ' ');
}
