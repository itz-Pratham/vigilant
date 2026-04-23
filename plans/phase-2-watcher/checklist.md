# Phase 2 — Implementation Checklist

## Types (`01-types.md`)
- [ ] Create `src/watcher/types.ts` — `DetectedIssue`, `ScanResult`, `PatternRule`, `WatcherTickSummary`, `WatcherState` with full JSDoc
- [ ] Add `ExternalToolFinding` type — `tool`, `comment`, `severity?`, `file?`, `line?`, `prNumber`
- [ ] Add `ToolObserverResult` type — `prNumber`, `findings`, `toolsPresent`

## PR Scanner (`02-pr-scanner.md`)
- [ ] Create `src/watcher/scanners/pr-scanner.ts`
- [ ] Fetch open PRs with ETag conditional request (`If-None-Match`)
- [ ] Filter PRs by file paths matching domain `watchedFilePaths` globs (minimatch)
- [ ] Fetch per-PR file list, check patch text against pattern rule search terms
- [ ] Save new ETag to `watcher_state` after each tick
- [ ] Return `ScanResult` with `notModified: true` on 304

## Commit Scanner (`06-commit-scanner.md`)
- [ ] Create `src/watcher/scanners/commit-scanner.ts`
- [ ] Fetch last 20 commits on default branch with ETag conditional request
- [ ] For each commit touching domain-relevant paths, fetch full diff
- [ ] Match diff text against pattern rule search terms
- [ ] Emit `DetectedIssue` with `sourceRef: "commit:{sha7}"`
- [ ] Extract up to 5 evidence lines (lines starting with `+` that match query terms)

## CI Scanner (`07-ci-scanner.md`)
- [ ] Create `src/watcher/scanners/ci-scanner.ts`
- [ ] Fetch failed workflow runs with ETag conditional request
- [ ] For each failed run, fetch job list and match job names against `ciKeywords`
- [ ] Emit `DetectedIssue` with `issueType: 'CI_DOMAIN_FAILURE'` and `sourceRef: "run:{id}/job:{id}"`
- [ ] `resolveCIIssueType()` maps `CI_DOMAIN_FAILURE` to the domain pack's specific CI issue type in the daemon loop

## Dependency Scanner (`04-dep-scanner.md`)
- [ ] Create `src/watcher/scanners/dep-scanner.ts`
- [ ] Fetch `package.json` from repo via GitHub Contents API with ETag
- [ ] Compare each watched package version against latest GitHub release tag
- [ ] Skip if only patch version differs (flag only major/minor gaps)
- [ ] Cache latest release lookups for 1 hour (in-memory `Map<string, {version, fetchedAt}>`)
- [ ] Emit `DetectedIssue` with `sourceRef: "package:{name}@{current}→{latest}"`

## Pattern Scanner (`03-pattern-scanner.md`)
- [ ] Create `src/watcher/scanners/pattern-scanner.ts`
- [ ] Rate-limit to one run per 5 minutes (`PATTERN_SCAN_MIN_INTERVAL_SECONDS`)
- [ ] For each `PatternRule`, call GitHub Search API code search scoped to `repo:owner/name`
- [ ] Apply `filePathPattern` regex filter to matched files if present
- [ ] Adjust confidence based on number of matches found
- [ ] Emit one `DetectedIssue` per matched file (not per match)

## Tool Observer (`09-tool-observer.md`)
- [ ] Create `src/watcher/tool-observer.ts` — `runToolObserver(owner, repo, openPrNumbers)`
- [ ] Add `TOOL_BOT_USERNAMES` map to `src/lib/constants.ts` (4 known bot logins)
- [ ] Read issue comments from `GET /repos/{owner}/{repo}/issues/{pr_number}/comments`
- [ ] Read PR reviews from `GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews`
- [ ] Filter comments by known bot usernames — unknown bots are ignored
- [ ] Parse severity, file path, and line number from comment text (best-effort)
- [ ] Return empty findings + `toolsPresent: false` on any API error (never throw)
- [ ] Log count of findings per PR at INFO level

## Daemon Loop / Integration (`08-integration.md`)
- [ ] Create `src/watcher/index.ts` — `startWatcher(repoSlug, activePacks, config)`
- [ ] Run all 5 scanners per pack in `Promise.allSettled` on each tick
- [ ] Deduplicate: call `sessionExistsForIssue()` before spawning any agent session
- [ ] Extract open PR numbers from scan results → pass to `runToolObserver()`
- [ ] Pass tool findings to `startAgentSession()` as 4th argument
- [ ] Resolve `CI_DOMAIN_FAILURE` → pack-specific CI issue type via `resolveCIIssueType()`
- [ ] Fire-and-forget `startAgentSession()` for each new issue (errors caught and logged)
- [ ] Track idle tick count; trigger `runLearner()` after `LEARNER_IDLE_TICKS_TRIGGER` consecutive idle ticks
- [ ] Log tick summary: issues found, new sessions started, deduplicated count

## CLI Integration
- [ ] Wire `vigilant start --repo <owner/repo> [--domain <id>] [--interval <s>]` to call `startWatcher`
- [ ] Print startup banner: repo, active domains, interval, session resume count

## Verification
- [ ] `vigilant start --repo org/repo` logs a tick every 60 seconds
- [ ] A PR touching a domain-relevant file path is detected and logged as `DetectedIssue`
- [ ] Same issue on the same sourceRef does not spawn a second session (dedup works)
- [ ] 304 responses logged as "no change" — zero rate-limit cost
- [ ] 429 response triggers backoff log and resumes — no crash
- [ ] Pattern scanner does not run more than once per 5 minutes
