// src/mcp/tools/getDomainPattern.ts
// MCP tool: return full pattern info for a vigilant issue type.

import { findPackForIssueType, resolveActivePacks } from '../../agent/domain-context.js';
import { loadConfig }          from '../../config/index.js';
import type { GetDomainPatternInput, ToolResult } from '../types.js';
import { textResult }          from '../types.js';

/**
 * Returns the full description, examples, and search query for an issue type.
 * Accepts an optional domain hint to disambiguate issue types shared across packs.
 */
export async function handleGetDomainPattern(
  input: GetDomainPatternInput,
): Promise<ToolResult> {
  // Normalize once and use everywhere
  const issueType = input.issueType.toUpperCase().trim();

  // If domain hint provided, search only within that pack
  let pack = findPackForIssueType(issueType);

  if (input.domain && (!pack || pack.id !== input.domain)) {
    // Try to find in the specified domain pack
    const config    = await loadConfig();
    const packs     = resolveActivePacks(config, input.domain);
    const candidate = packs.find(p => p.id === input.domain && p.issueTypes.includes(issueType));
    if (candidate) pack = candidate;
  }

  if (!pack) {
    // List all known issue types as a help text
    const allPacks  = findPackForIssueType('__ALL__'); // won't match — safe
    const config    = await loadConfig();
    const allActive = resolveActivePacks(config);
    const knownTypes = allActive
      .flatMap(p => p.issueTypes.map(t => `  • \`${t}\` (${p.id})`))
      .join('\n');

    return textResult(
      `Unknown issue type: \`${issueType}\`\n\nAvailable issue types:\n${knownTypes}`,
    );
    void allPacks;
  }

  // Look up pattern rule for description + searchQuery + severity
  const patternRule   = pack.patternRules.find(r => r.issueType === issueType);
  // Look up fix strategy for code examples + explanation
  const fixStrategy   = pack.fixStrategies[issueType];

  const lines: string[] = [
    `## \`${issueType}\``,
    `**Domain:** ${pack.id}  |  **Severity:** ${patternRule?.severity ?? 'UNKNOWN'}`,
    '',
    patternRule?.description ?? fixStrategy?.explanation ?? 'No description available.',
  ];

  if (fixStrategy?.exampleBefore) {
    lines.push('', '### ❌ Problematic pattern', '```typescript', fixStrategy.exampleBefore, '```');
  }

  if (fixStrategy?.exampleAfter) {
    lines.push('', '### ✅ Recommended pattern', '```typescript', fixStrategy.exampleAfter, '```');
  }

  if (patternRule?.searchQuery) {
    lines.push('', '**GitHub search query vigilant uses:**', '```', patternRule.searchQuery, '```');
  }

  if (fixStrategy?.investigationHints?.length) {
    lines.push('', '**Investigation hints:**');
    fixStrategy.investigationHints.forEach(h => lines.push(`- ${h}`));
  }

  return textResult(lines.join('\n'));
}
