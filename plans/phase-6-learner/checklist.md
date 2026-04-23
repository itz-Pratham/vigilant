# Phase 6 — Implementation Checklist

## Types (`01-types.md`)
- [ ] Create `src/learner/types.ts`
- [ ] `LearningTopic`: `{ id, domain, topic, sourceType, lastRunAt, runCount }`
- [ ] `SourceType` union: `github_prs | github_advisories | engineering_blog | cve_database | trending_repos | git_history | team_decisions`
- [ ] `ResearchResult`: `{ topic, sourceType, documents, durationMs, itemsAdded }`
- [ ] `ResearchDocument`: `{ title, url, content, domain, sourceType, tags }`
- [ ] `GitHistoryEntry`: `{ sha, message, author, date, url, files? }`
- [ ] `TeamDecisionDoc`: `{ path, content, sha }`
- [ ] `learning_topics` SQLite table schema
- [ ] `learned_urls` SQLite table schema

## Topic Queue (`02-topic-queue.md`)
- [ ] Create `src/learner/topicQueue.ts`
- [ ] `getNextTopic(db)` — `ORDER BY COALESCE(last_run_at, 0) ASC LIMIT 1`
- [ ] `markTopicRun(db, id)` — updates `last_run_at = Date.now()`, increments `run_count`
- [ ] `seedTopics(db)` — idempotent: checks `COUNT(*) > 0` before inserting
- [ ] 16 seed topics: 4 per domain × 4 domains, mixed source types
- [ ] Round-robin guarantee: never-run topics (last_run_at=0) always go first

## GitHub Researcher (`03-github-researcher.md`)
- [ ] Create `src/learner/githubResearcher.ts`
- [ ] `searchMergedPRs(octokit, neurolink, topic)` — `search.issuesAndPullRequests()` with merged+fix query
- [ ] Sort by `reactions`, `order: desc` — most-upvoted = most relevant
- [ ] NeuroLink summarise each PR body: title + URL + body → markdown summary ≤400 words
- [ ] Max 5 PRs per run (`MAX_PRS_PER_RUN = 5`)
- [ ] `searchAdvisories(octokit, neurolink, topic)` — GitHub Advisory Database API
- [ ] NeuroLink summarise advisories: CVE ID + severity + description → fix pattern summary
- [ ] Max 3 advisories per run

## Web Researcher (`04-web-researcher.md`)
- [ ] Create `src/learner/webResearcher.ts`
- [ ] `DOMAIN_BLOG_URLS` map: payments, security, reliability, compliance → URL arrays
- [ ] `researchEngBlog(neurolink, topic)` — NeuroLink `autoResearch()` with `{ seedUrls, depth: 2, maxPages: 8 }`
- [ ] Max 2 blog URLs per run to stay within rate limits
- [ ] Fallback: if `autoResearch` unavailable, use single `neurolink.generate()` call with fetched text
- [ ] `researchCVE(neurolink, topic)` — NVD API `https://services.nvd.nist.gov/rest/json/cves/2.0`
- [ ] Summarise first 3 CVEs with NeuroLink: what to avoid + how to fix
- [ ] AutoResearch failures are non-fatal (try/catch, continue)

## RAG Store (`05-rag-store.md`)
- [ ] Create `src/learner/ragStore.ts`
- [ ] `addKnowledgeDocument(db, neurolink, doc)` — check `learned_urls`, then `neurolink.addDocument()`
- [ ] Mandatory metadata fields: `title`, `url`, `domain`, `tags`, `scope: 'global'`, `addedAt`
- [ ] Returns `boolean` (true = added, false = skipped dedup)
- [ ] `storeResearchResults(db, neurolink, docs)` — loop all docs, return count added
- [ ] Knowledge database (`knowledge.db`) is separate from state database (`state.db`)
- [ ] NeuroLink handles chunking and embedding automatically

## Learn Command (`06-learn-command.md`)
- [ ] Create `src/commands/learn.ts`
- [ ] `vigilant learn` — round-robin queue pick
- [ ] `vigilant learn --topic <topic>` — override with custom topic string
- [ ] `vigilant learn --domain <domain>` — restrict to one domain
- [ ] Output: `✓ Added N new document(s)` with topic, source, duration
- [ ] Output on dedup: `No new documents added (all URLs already in knowledge base)`
- [ ] Register command in `src/bin.ts`

## Idle Trigger (`07-idle-trigger.md`)
- [ ] Create `src/learner/idleTrigger.ts`
- [ ] `shouldRunLearner(newIssuesFound)` — module-level `idleTickCount`, returns boolean
- [ ] Resets `idleTickCount = 0` when any issues found
- [ ] Resets `idleTickCount = 0` after triggering (so next batch of idle ticks can trigger again)
- [ ] `LEARNER_IDLE_TICKS_TRIGGER = 10` in `src/constants.ts`
- [ ] Fire-and-forget: `runLearner(...).catch(err => logger.warn(...))`

## Entry Point (`08-entry-point.md`)
- [ ] Create `src/learner/index.ts` — `runLearner(db, kdb, octokit, neurolink, opts)`
- [ ] `seedTopics(db)` called at start of every `runLearner()` call
- [ ] `LearnerOptions`: `{ customTopic?, domain?, owner?, repo? }`
- [ ] Switch on `sourceType` to call correct researcher
- [ ] `trending_repos`: reuses `searchMergedPRs` with modified query
- [ ] `git_history`: calls `runGitHistoryResearch(owner, repo, domain, neurolink)`
- [ ] `team_decisions`: calls `runDecisionDocResearch(owner, repo, domain, neurolink)`
- [ ] `markTopicRun(db, topic.id)` called after every run (even zero results)
- [ ] Returns `ResearchResult` always (never throws)

## Git History Researcher (`11-git-history-researcher.md`)
- [ ] Create `src/learner/researchers/git-history-researcher.ts`
- [ ] `runGitHistoryResearch(owner, repo, domain, neurolink, limit?)` entry point
- [ ] Search merged PRs via `search.issuesAndPullRequests()` using domain keywords
- [ ] Fetch files changed per PR via `pulls.listFiles()`
- [ ] Summarise each PR with NeuroLink: what pattern/practice was introduced or fixed
- [ ] Store docs with `source_type: 'git_history'`, scope `repo:owner/name`
- [ ] SHA-based URL key: `git_history:owner/repo:pr:{number}` — dedup guard
- [ ] Domain keyword map: payments, security, reliability, compliance
- [ ] Rate limit: ~21 API calls + 20 AI calls per run; runs on idle ticks only

## Decision Doc Researcher (`12-decision-doc-researcher.md`)
- [ ] Create `src/learner/researchers/decision-doc-researcher.ts`
- [ ] `runDecisionDocResearch(owner, repo, domain, neurolink)` entry point
- [ ] Candidate paths: `decision.md`, `DECISION.md`, `decisions.md`, `adr/`, `docs/decisions/`, `docs/adr/`, `docs/architecture/`, `.adr/`
- [ ] `readPathOrDirectory()` helper — handles both files and directories; max 10 files per directory
- [ ] Skip 404s silently (not all repos have decision docs)
- [ ] SHA-based dedup key: `team_decision:owner/repo:{path}:{sha}` — re-processes when file changes
- [ ] Summarise per document: what domain-relevant decisions does this capture?
- [ ] Skip documents NeuroLink marks "Not relevant to {domain}"
- [ ] Store docs with `source_type: 'team_decisions'`, scope `repo:owner/name`
- [ ] Rate limit: ~1–10 API calls + ~N AI calls per run

## Deduplication (`09-dedup.md`)
- [ ] Create `src/learner/dedup.ts`
- [ ] `isKnownUrl(db, url)` — `SELECT 1 FROM learned_urls WHERE url = ?`
- [ ] `getLearnedUrls(db, domain)` — all URLs for a domain, ordered by `added_at DESC`
- [ ] `forgetUrl(db, url)` — `DELETE FROM learned_urls WHERE url = ?` (for `--force-url` flag)
- [ ] `getKnowledgeStats(db)` — count per domain (for `vigilant status --knowledge`)
- [ ] `learned_urls.url` is `PRIMARY KEY` — SQLite enforces uniqueness at DB level

## Integration (`10-integration.md`)
- [ ] `seedTopics(db)` called in `src/commands/start.ts` before watcher loop
- [ ] `shouldRunLearner()` called in watcher tick after dedup step
- [ ] `learning_topics` and `learned_urls` tables created in `getStateDb()`
- [ ] Learner `index.ts` switch handles all 7 source types (including `git_history` + `team_decisions`)
- [ ] Owner/repo passed to git history and decision doc researchers from watcher config
- [ ] No new npm dependencies needed (all existing packages reused)

## Verification
- [ ] `vigilant learn` picks the least recently run topic from the queue
- [ ] Running `vigilant learn` twice with same topic does not duplicate documents
- [ ] After 10 idle watcher ticks, learner fires automatically
- [ ] `vigilant learn --topic "custom topic"` uses custom topic with queue domain
- [ ] New documents appear in RAG search during next agent investigation
- [ ] `learned_urls` table grows with each new URL added
- [ ] Learner failure does not crash the daemon (fire-and-forget, error is only logged)
- [ ] Git history researcher stores docs scoped to `repo:owner/name` (not global)
- [ ] Decision doc researcher re-processes a file when its SHA changes (new commit)
- [ ] Decision doc researcher skips repos with no decision docs silently
- [ ] `source_type` is stored in `knowledge_documents` for all 7 source types