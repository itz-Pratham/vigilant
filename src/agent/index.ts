// src/agent/index.ts
// Agent session management — full agentic loop implemented in Phase 3.

import type { DetectedIssue, IssueSession } from './types.js';
import type { ExternalToolFinding } from '../watcher/types.js';
import type { DomainPack } from './domain-context.js';
import type { VigilantConfig } from '../config/types.js';
import { info } from '../lib/logger.js';

/**
 * Start an investigation session for a detected issue.
 * Phase 3 replaces this stub with the full agentic loop.
 */
export async function startAgentSession(
  issue: DetectedIssue,
  _activePacks: DomainPack[],
  _config: VigilantConfig,
  _toolFindings: ExternalToolFinding[] = [],
): Promise<IssueSession | null> {
  info(
    `[Phase 3 stub] Would start session for ${issue.issueType} at ${issue.sourceRef}`,
    'agent',
    { domain: issue.domain, severity: issue.severity, confidence: issue.confidence },
  );
  return null;
}

/**
 * Resume an interrupted session after daemon restart.
 * Phase 3 replaces this stub.
 */
export async function resumeSession(_sessionId: string): Promise<void> {
  info(`[Phase 3 stub] Would resume session ${_sessionId}`, 'agent');
}
