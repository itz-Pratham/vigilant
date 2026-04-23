# Phase 2 — Dependency Scanner

**File:** `src/watcher/scanners/dep-scanner.ts`

## Objective

Read the repo's `package.json`, compare payment/security SDK versions against their latest releases on GitHub, and flag any package that is behind by at least one minor version. This catches SDK version drift — a common source of security vulnerabilities and missing features.

---

## GitHub API Used

```
GET /repos/{owner}/{repo}/contents/package.json
  Headers: If-None-Match: {lastEtag}

GET /repos/{packageOwner}/{packageRepo}/releases/latest
  (once per watched package, cached for 1 hour)
```

---

## Watched Packages Per Domain

```typescript
const WATCHED_PACKAGES: Record<string, string[]> = {
  payments: [
    'stripe', '@stripe/stripe-js',
    'razorpay', '@juspay/hypercheckout',
    'braintree', '@braintree/browser-drop-in',
    'square', '@square/web-sdk',
    'paypal__sdk',
  ],
  security: [
    'jsonwebtoken', 'bcrypt', 'bcryptjs',
    'passport', 'helmet', 'cors',
    'express-rate-limit', 'express-validator',
  ],
  reliability: [
    'axios', 'node-fetch', 'got',
    'opossum',   // circuit breaker
    'p-retry', 'async-retry',
    'bull', 'bullmq',
  ],
};

// Maps npm package name → GitHub repo for fetching latest release
const PACKAGE_GITHUB_REPOS: Record<string, string> = {
  'stripe': 'stripe/stripe-node',
  '@stripe/stripe-js': 'stripe/stripe-js',
  'razorpay': 'razorpay/razorpay-node',
  'jsonwebtoken': 'auth0/node-jsonwebtoken',
  'helmet': 'helmetjs/helmet',
  'axios': 'axios/axios',
  'opossum': 'nodeshift/opossum',
};
```

---

## Full Implementation

```typescript
import type { ScanResult, DetectedIssue } from '@/watcher/types';
import { conditionalGet, githubRequest } from '@/lib/github';
import { getWatcherState, upsertWatcherState } from '@/db/queries/watcher';
import { info } from '@/lib/logger';

const DEP_SCANNER_INTERVAL_MINUTES = 5;

// In-memory cache: packageName → { latestVersion, cachedAt }
const versionCache = new Map<string, { latestVersion: string; cachedAt: number }>();
const VERSION_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function scanDependencies(params: {
  owner: string;
  repo: string;
  domain: string;
}): Promise<ScanResult> {
  const { owner, repo, domain } = params;
  const scannerName = 'dep-scanner';
  const state = getWatcherState(owner, repo, scannerName);

  if (state?.lastCheckedAt) {
    const minutesSince = (Date.now() - new Date(state.lastCheckedAt).getTime()) / 60_000;
    if (minutesSince < DEP_SCANNER_INTERVAL_MINUTES) {
      return { scanner: scannerName, issues: [], notModified: true };
    }
  }

  // Fetch package.json from repo (with ETag)
  const result = await conditionalGet({
    endpoint: `/repos/${owner}/${repo}/contents/package.json`,
    octokitFn: (headers) =>
      githubRequest(octokit =>
        octokit.rest.repos.getContent({ owner, repo, path: 'package.json', headers } as Parameters<typeof octokit.rest.repos.getContent>[0])
      ),
    lastEtag: state?.lastEtag ?? null,
    context: 'watcher',
  });

  if (!result) {
    return { scanner: scannerName, issues: [], notModified: true };
  }

  const { data: fileData, etag } = result;

  if (!('content' in fileData)) {
    return { scanner: scannerName, issues: [] };
  }

  let packageJson: Record<string, Record<string, string>>;
  try {
    packageJson = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf-8'));
  } catch {
    return { scanner: scannerName, issues: [] };
  }

  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  const watchedPackages = WATCHED_PACKAGES[domain] ?? [];
  const issues: DetectedIssue[] = [];

  for (const pkgName of watchedPackages) {
    const currentVersion = allDeps[pkgName];
    if (!currentVersion) continue;

    const cleanCurrent = currentVersion.replace(/^[\^~>=<]/, '');
    const ghRepo = PACKAGE_GITHUB_REPOS[pkgName];
    if (!ghRepo) continue;

    const latestVersion = await getLatestVersion(ghRepo);
    if (!latestVersion) continue;

    if (isMinorVersionBehind(cleanCurrent, latestVersion)) {
      issues.push({
        issueType: 'SDK_VERSION_DRIFT',
        severity: 'MEDIUM',
        confidence: 1.0,  // 100% confident — it's a fact
        sourceRef: `package:${pkgName}@${cleanCurrent}→${latestVersion}`,
        evidence: [
          `Package: ${pkgName}`,
          `Current version in package.json: ${cleanCurrent}`,
          `Latest release: ${latestVersion}`,
          `Repository: github.com/${ghRepo}`,
        ],
        domain,
        repoOwner: owner,
        repoName: repo,
        detectedAt: new Date().toISOString(),
      });

      info(`Dependency drift: ${pkgName} ${cleanCurrent} → ${latestVersion}`, 'watcher');
    }
  }

  upsertWatcherState({ repoOwner: owner, repoName: repo, scannerName, lastEtag: etag, lastCheckedAt: new Date().toISOString() });

  return { scanner: scannerName, issues, newEtag: etag };
}

async function getLatestVersion(ghRepo: string): Promise<string | null> {
  const cached = versionCache.get(ghRepo);
  if (cached && Date.now() - cached.cachedAt < VERSION_CACHE_TTL_MS) {
    return cached.latestVersion;
  }

  const [repoOwner, repoName] = ghRepo.split('/');
  try {
    const release = await githubRequest(
      octokit => octokit.rest.repos.getLatestRelease({ owner: repoOwner, repo: repoName }),
      'watcher'
    );
    const version = release.data.tag_name.replace(/^v/, '');
    versionCache.set(ghRepo, { latestVersion: version, cachedAt: Date.now() });
    return version;
  } catch {
    return null;
  }
}

function isMinorVersionBehind(current: string, latest: string): boolean {
  const parse = (v: string) => v.split('.').map(n => parseInt(n, 10));
  const [cMaj, cMin] = parse(current);
  const [lMaj, lMin] = parse(latest);
  return lMaj > cMaj || (lMaj === cMaj && lMin > cMin);
}
```
