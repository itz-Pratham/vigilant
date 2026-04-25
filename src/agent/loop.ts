// src/agent/loop.ts
// The outer investigation loop.
// Each outer iteration: build context → call neurolink.generate() → extract progress → save.
// Loop exits when goalProgress ≥ threshold, maxIterations reached, or session is blocked.

import { NeuroLink }             from '@juspay/neurolink';
import { info, warn, error }     from '../lib/logger.js';
import { saveSession }           from '../db/queries/sessions.js';
import { AIProviderError }       from '../lib/errors.js';
import {
  GOAL_PROGRESS_THRESHOLD,
  STALL_THRESHOLD,
  DEFAULT_MAX_ITERATIONS,
  STALL_MIN_DELTA,
  AI_MAX_RETRIES,
  AI_RETRY_BASE_MS,
  STAGE,
} from '../lib/constants.js';
import type { IssueSession } from './types.js';
import type { DomainPack }   from './domain-context.js';
import type { VigilantConfig } from '../config/types.js';
import { buildPrepareStepFn }              from './prepare-step.js';
import { buildAgentTools }                 from './tools.js';
import { buildInvestigationSystemPrompt, buildIterationContext, extractProgressUpdate } from './prompts.js';

const MAX_ITERATIONS = DEFAULT_MAX_ITERATIONS;

/**
 * Run the agentic investigation loop for a session until:
 * - goalProgress ≥ GOAL_PROGRESS_THRESHOLD, or
 * - iterationCount reaches MAX_ITERATIONS, or
 * - STALL_THRESHOLD consecutive iterations with no progress delta, or
 * - an unrecoverable error occurs (session is marked blocked)
 */
export async function runAgentLoop(
  session: IssueSession,
  pack:    DomainPack,
  config:  VigilantConfig,
): Promise<void> {
  if (!config.geminiApiKey) {
    session.stage         = STAGE.BLOCKED;
    session.blockerReason = 'VIGILANT_GEMINI_API_KEY is not configured';
    saveSession(session);
    return;
  }

  const neurolink     = new NeuroLink();
  const systemPrompt  = buildInvestigationSystemPrompt(session, pack);
  const tools         = buildAgentTools(session);
  let   lastProgress  = session.goalProgress;

  info(`Starting investigation loop for ${session.sessionId}`, 'loop');

  while (session.iterationCount < MAX_ITERATIONS) {
    if (session.goalProgress >= GOAL_PROGRESS_THRESHOLD) {
      info(`Goal progress ${session.goalProgress.toFixed(2)} reached threshold — investigation complete`, 'loop');
      break;
    }

    if (session.stallCount >= STALL_THRESHOLD) {
      warn(`Session ${session.sessionId} stalled — blocking`, 'loop');
      session.stage         = STAGE.BLOCKED;
      session.blockerReason = `No progress for ${STALL_THRESHOLD} consecutive iterations`;
      saveSession(session);
      return;
    }

    const iterInput   = buildIterationContext(session, session.iterationCount);
    const prepareStep = buildPrepareStepFn(session.iterationCount);

    let result: { content: string } | null = null;
    let attempt = 0;

    while (attempt < AI_MAX_RETRIES) {
      try {
        result = await neurolink.generate({
          input:        { text: iterInput },
          systemPrompt,
          tools,
          prepareStep,
          maxSteps:     5,
          provider:     'google-ai',
          credentials:  { googleAiStudio: { apiKey: config.geminiApiKey } },
        });
        break;
      } catch (err) {
        attempt++;
        const msg = err instanceof Error ? err.message : String(err);
        warn(`AI call failed (attempt ${attempt}/${AI_MAX_RETRIES}): ${msg}`, 'loop');

        if (attempt >= AI_MAX_RETRIES) {
          error(`All ${AI_MAX_RETRIES} AI attempts exhausted for ${session.sessionId}`, 'loop');
          session.stage         = STAGE.BLOCKED;
          session.blockerReason = `AI provider error after ${AI_MAX_RETRIES} retries: ${msg}`;
          saveSession(session);
          throw new AIProviderError(msg, undefined, 'google-ai');
        }

        await sleep(AI_RETRY_BASE_MS * Math.pow(2, attempt - 1));
      }
    }

    if (!result) break;

    // Extract progress update from model response
    const { goalProgress, keyFindings } = extractProgressUpdate(result.content, session);

    // Stall detection
    const delta = goalProgress - lastProgress;
    if (delta < STALL_MIN_DELTA) {
      session.stallCount = (session.stallCount ?? 0) + 1;
    } else {
      session.stallCount = 0;
    }

    lastProgress           = goalProgress;
    session.goalProgress   = goalProgress;
    session.keyFindings    = keyFindings;
    session.iterationCount = session.iterationCount + 1;

    saveSession(session);

    info(
      `Iteration ${session.iterationCount}: progress=${goalProgress.toFixed(2)}, findings=${keyFindings.length}`,
      'loop',
    );
  }

  if (session.goalProgress < GOAL_PROGRESS_THRESHOLD && session.stage !== STAGE.BLOCKED) {
    warn(
      `Investigation ended at ${session.goalProgress.toFixed(2)} confidence after ${session.iterationCount} iterations`,
      'loop',
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
