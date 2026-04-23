# Phase 3 — Agentic Loop

**File:** `src/agent/loop.ts`

## Objective

The main agentic loop function. Takes a session, runs NeuroLink generate() calls in a loop with mandatory prepareStep enforcement, executes tool calls the model requests, updates session state after every iteration, and hands a completed session to the plan generator when goalProgress is sufficient.

This is the cognitive engine of vigilant. The architecture is directly adapted from Lighthouse's `executor.ts` production agentic loop at Juspay.

---

## prepareStep Enforcement (`src/agent/prepare-step.ts`)

```typescript
import type { AgentToolName } from './types';

export type PrepareStep = {
  tool: AgentToolName;
  /** Additional instructions injected into the system prompt for this step */
  instruction?: string;
};

/**
 * Returns the mandatory tool for the given iteration.
 * Copied from Lighthouse executor.ts pattern.
 *
 * Iteration 0: getCurrentTime  — grounds agent in temporal context
 * Iteration 1: sequentialThinking — forces reasoning before acting
 * Iteration 2+: undefined — toolChoice: 'auto'
 */
export function buildPrepareStep(iterationCount: number): PrepareStep | undefined {
  if (iterationCount === 0) {
    return {
      tool: 'getCurrentTime',
      instruction: 'First, get the current time to ground your temporal context.',
    };
  }
  if (iterationCount === 1) {
    return {
      tool: 'sequentialThinking',
      instruction: 'Think step by step about the issue you are investigating. What do you know? What do you need to find out? What files should you look at first?',
    };
  }
  return undefined;  // Agent chooses freely from step 2 onwards
}
```

---

## System Prompt Per Issue Type

Each `IssueType` has a custom investigation system prompt. The agent is given its sessionId, the sourceRef, and the evidence at the start of every generate() call.

```typescript
// src/agent/prompts.ts

export function buildInvestigationSystemPrompt(session: IssueSession, domainPack: DomainPack): string {
  const fixStrategy = domainPack.fixStrategies.find(s => s.issueType === session.issueType);

  return `
You are vigilant, an autonomous code intelligence agent.

Your task: investigate the following issue in the repository ${session.repoOwner}/${session.repoName}.

Issue Type: ${session.issueType}
Severity: ${session.severity}
Source: ${session.sourceRef}
Domain: ${session.domain}

Evidence from scanner:
${session.evidence.map(e => `- ${e}`).join('\n')}

${fixStrategy ? `
Known fix pattern for this issue type:
Before: ${fixStrategy.exampleBefore}
After: ${fixStrategy.exampleAfter}
Hint: ${fixStrategy.promptHint}
` : ''}

Your investigation goals:
1. Understand exactly what the issue is and where in the code it occurs
2. Determine the root cause (not just the symptom)
3. Identify every file that needs to change
4. Formulate a precise, minimal fix

After each step, report:
- goalProgress: a number 0.0–1.0 indicating how complete your investigation is
- keyFindings: array of strings, each a one-sentence finding
- nextAction: what you plan to do next (for transparency)

When goalProgress reaches 0.9 or higher, you have enough information to generate the fix plan.
Do not make up information. If a file does not exist, say so.
`.trim();
}
```

---

## Main Loop (`src/agent/loop.ts`)

```typescript
import NeuroLink from '@juspay/neurolink';
import type { IssueSession } from './types';
import { buildPrepareStep } from './prepare-step';
import { buildInvestigationSystemPrompt } from './prompts';
import { getAgentTools, executeToolCall } from './tools';
import { saveSession } from '@/db/queries/sessions';
import { loadConfig } from '@/config/index';
import { loadDomainPack } from './domain-packs';
import { info, warn, error } from '@/lib/logger';
import { MAX_ITERATIONS, STALL_THRESHOLD, GOAL_PROGRESS_THRESHOLD } from '@/lib/constants';

/**
 * Run the agentic investigation loop for a session.
 * Modifies and saves the session in place.
 * Returns when goalProgress >= 0.9, or when blocked/max iterations reached.
 */
export async function runAgentLoop(session: IssueSession): Promise<IssueSession> {
  const config = loadConfig();
  const domainPack = loadDomainPack(session.domain);
  const maxIterations = config.maxIterations ?? MAX_ITERATIONS;

  // Initialise NeuroLink with configured providers
  const neurolink = new NeuroLink({
    providers: [
      config.geminiApiKey  ? { name: 'google', apiKey: config.geminiApiKey } : null,
      config.groqApiKey    ? { name: 'groq',   apiKey: config.groqApiKey }   : null,
      config.openaiApiKey  ? { name: 'openai', apiKey: config.openaiApiKey } : null,
      config.ollamaBaseUrl ? { name: 'ollama', baseUrl: config.ollamaBaseUrl } : null,
    ].filter(Boolean),
  });

  const systemPrompt = buildInvestigationSystemPrompt(session, domainPack);
  const tools = getAgentTools(session);

  info(`Starting agent loop`, session.sessionId, {
    issueType: session.issueType,
    sourceRef: session.sourceRef,
    maxIterations,
  });

  session.stage = 'investigating';
  saveSession(session);

  let lastGoalProgress = 0;
  let stallCount = 0;

  while (
    session.goalProgress < GOAL_PROGRESS_THRESHOLD &&
    session.iterationCount < maxIterations
  ) {
    const prepareStep = buildPrepareStep(session.iterationCount);

    info(
      `Iteration ${session.iterationCount}${prepareStep ? ` (forced: ${prepareStep.tool})` : ''}`,
      session.sessionId,
      { goalProgress: session.goalProgress }
    );

    let response;
    try {
      response = await neurolink.generate({
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: buildIterationContext(session),
          }
        ],
        tools,
        toolChoice: prepareStep ? 'required' : 'auto',
        prepareStep: prepareStep ? { tool: prepareStep.tool } : undefined,
      });
    } catch (err: unknown) {
      error(`NeuroLink generate() failed at iteration ${session.iterationCount}`, session.sessionId, {
        error: (err as Error).message
      });
      session.stage = 'blocked';
      session.blockerReason = `AI provider error at iteration ${session.iterationCount}: ${(err as Error).message}`;
      saveSession(session);
      return session;
    }

    // Execute any tool calls the model requested
    if (response.toolCalls && response.toolCalls.length > 0) {
      for (const toolCall of response.toolCalls) {
        const result = await executeToolCall(toolCall, session);
        // Merge tool results into dataCollected
        session.dataCollected[`${toolCall.name}_${session.iterationCount}`] = result;
      }
    }

    // Extract progress signals from model response
    const progressUpdate = extractProgressUpdate(response.content ?? '');
    if (progressUpdate) {
      if (progressUpdate.goalProgress > session.goalProgress) {
        session.goalProgress = progressUpdate.goalProgress;
        stallCount = 0;
      } else {
        stallCount++;
      }
      if (progressUpdate.keyFindings.length > 0) {
        session.keyFindings.push(...progressUpdate.keyFindings);
      }
    }

    session.iterationCount++;
    session.stallCount = stallCount;
    saveSession(session);

    // Stall detection: blocked if no progress for STALL_THRESHOLD consecutive iterations
    if (stallCount >= STALL_THRESHOLD) {
      warn(`Agent stalled for ${stallCount} iterations`, session.sessionId, {
        goalProgress: session.goalProgress
      });
      session.stage = 'blocked';
      session.blockerReason = `Investigation stalled at goalProgress ${session.goalProgress.toFixed(2)} after ${session.iterationCount} iterations. Manual review needed.`;
      saveSession(session);
      return session;
    }
  }

  if (session.iterationCount >= maxIterations) {
    warn(`Max iterations (${maxIterations}) reached`, session.sessionId);
    // Still attempt plan generation if we have reasonable progress
    if (session.goalProgress < 0.5) {
      session.stage = 'blocked';
      session.blockerReason = `Max iterations reached with only ${(session.goalProgress * 100).toFixed(0)}% progress. Not enough information to generate a plan.`;
      saveSession(session);
      return session;
    }
  }

  info(`Investigation complete`, session.sessionId, {
    goalProgress: session.goalProgress,
    iterations: session.iterationCount,
    findings: session.keyFindings.length,
  });

  return session;
}

/**
 * Build the user message for each iteration, injecting current session state
 * so the model has full context without re-reading the whole history.
 */
function buildIterationContext(session: IssueSession): string {
  return `
Iteration ${session.iterationCount}. Current investigation state:

Goal progress: ${(session.goalProgress * 100).toFixed(0)}%
Key findings so far:
${session.keyFindings.length > 0
    ? session.keyFindings.map(f => `- ${f}`).join('\n')
    : '- None yet'}

Continue your investigation. Use the available tools to gather more information.
When you have enough context (goalProgress 0.9+), stop investigating and I will generate the fix plan.
  `.trim();
}

/**
 * Extract progress signals from the model's text response.
 * The model is instructed to include these in a structured format.
 */
function extractProgressUpdate(content: string): {
  goalProgress: number;
  keyFindings: string[];
} | null {
  // Try JSON extraction first
  const jsonMatch = content.match(/```json\s*(\{[\s\S]*?\})\s*```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      return {
        goalProgress: typeof parsed.goalProgress === 'number' ? parsed.goalProgress : 0,
        keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [],
      };
    } catch { /* fall through */ }
  }

  // Fallback: extract progress from natural language
  const progressMatch = content.match(/goalProgress[:\s]+([0-9.]+)/i);
  const progress = progressMatch ? parseFloat(progressMatch[1]) : 0;
  const findings = content
    .split('\n')
    .filter(l => l.trim().startsWith('-') || l.trim().startsWith('•'))
    .map(l => l.replace(/^[-•]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5);

  return { goalProgress: Math.min(progress, 1.0), keyFindings: findings };
}
```
