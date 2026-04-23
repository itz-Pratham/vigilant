# Phase 6 — Learn Command

**File:** `src/commands/learn.ts`

## Objective

`vigilant learn [--topic <custom>]` triggers a one-off research run immediately — without waiting for the idle trigger. Useful for bootstrapping the knowledge base for a new domain or manually adding knowledge about a specific topic.

---

## Implementation

```typescript
// src/commands/learn.ts
import { Command } from 'commander';
import { runLearner } from '../learner/index.js';
import { loadConfig }  from '../config.js';
import { getStateDb }  from '../db/state.js';
import { getKnowledgeDb } from '../db/knowledge.js';
import { Octokit }     from '@octokit/rest';
import { NeuroLink }   from '@juspay/neurolink';
import { seedTopics }  from '../learner/topicQueue.js';
import chalk           from 'chalk';

export const learnCommand = new Command('learn')
  .description('Run a manual knowledge research job')
  .option('--topic <topic>', 'Custom topic to research (overrides round-robin queue)')
  .option('--domain <domain>', 'Domain to research for (default: all active domains)')
  .action(async (opts) => {
    const config = await loadConfig();
    const db     = getStateDb();
    const kdb    = getKnowledgeDb(config.vigilantDir);

    const octokit = new Octokit({ auth: config.githubToken });
    const neurolink = new NeuroLink({
      providers: [
        { name: 'google', apiKey: config.geminiApiKey },
        { name: 'groq',   apiKey: config.groqApiKey },
      ],
      rag: { db: kdb },
    });

    seedTopics(db); // ensure topics exist

    const result = await runLearner(db, kdb, octokit, neurolink, {
      customTopic: opts.topic,
      domain:      opts.domain ?? undefined,
    });

    if (result.itemsAdded === 0) {
      console.log(chalk.yellow('No new documents added (all URLs already in knowledge base)'));
    } else {
      console.log(chalk.green(`✓ Added ${result.itemsAdded} new document(s) to knowledge base`));
      console.log(chalk.grey(`  Topic: ${result.topic}`));
      console.log(chalk.grey(`  Source: ${result.sourceType}`));
      console.log(chalk.grey(`  Duration: ${(result.durationMs / 1000).toFixed(1)}s`));
    }
  });
```

---

## Usage Examples

```bash
# Use round-robin queue (picks least recently run topic)
vigilant learn

# Research a specific topic
vigilant learn --topic "webhook signature verification"

# Research for a specific domain only
vigilant learn --domain security

# Research a custom topic in a specific domain
vigilant learn --topic "JWT expiry best practices" --domain security
```

---

## Output Format

```
✓ Added 3 new document(s) to knowledge base
  Topic: idempotency keys in payment APIs
  Source: github_prs
  Duration: 12.4s
```

Or on dedup:
```
No new documents added (all URLs already in knowledge base)
```
