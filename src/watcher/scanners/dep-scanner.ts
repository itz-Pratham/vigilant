// src/watcher/scanners/dep-scanner.ts
// Compares package.json dependencies against the latest published npm versions.
// Flags SDK version drift (major or minor gaps) for domain-relevant packages.

import { githubRequest } from '../../lib/github.js';
import { warn, debug } from '../../lib/logger.js';
import type { ScanResult, DetectedIssue } from '../types.js';
import type { DomainPack } from '../../agent/domain-context.js';

type NpmDist = { version: string };
type PackageJson = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

/** In-memory version cache with 1-hour TTL. */
const versionCache: Map<string, { version: string; fetchedAt: number }> = new Map();
const VERSION_CACHE_TTL_MS = 60 * 60 * 1000;

async function getLatestVersion(pkg: string): Promise<string | null> {
  const cached = versionCache.get(pkg);
  if (cached && Date.now() - cached.fetchedAt < VERSION_CACHE_TTL_MS) {
    return cached.version;
  }
  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`);
    if (!res.ok) return null;
    const data = (await res.json()) as NpmDist;
    versionCache.set(pkg, { version: data.version, fetchedAt: Date.now() });
    return data.version;
  } catch {
    return null;
  }
}

function parseMajorMinor(v: string): [number, number] {
  const clean = v.replace(/^[^0-9]*/, '');
  const [major = 0, minor = 0] = clean.split('.').map(Number);
  return [major, minor];
}

/** Domain-relevant SDK package names by domain id. */
const DOMAIN_PACKAGES: Record<string, string[]> = {
  payments:    ['stripe', '@stripe/stripe-js', 'razorpay', 'braintree', 'paypal-rest-sdk', '@juspay/hypercheckout'],
  security:    ['jsonwebtoken', 'bcrypt', 'bcryptjs', 'helmet', 'express-rate-limit'],
  reliability: ['axios', 'node-fetch', 'got', 'ioredis', 'pg', 'mongodb'],
  compliance:  ['winston', 'pino', 'bunyan'],
};

export async function scanDependencies(params: {
  owner:       string;
  repo:        string;
  activePacks: DomainPack[];
}): Promise<ScanResult> {
  const { owner, repo, activePacks } = params;
  const scanner = 'dep-scanner';

  // Fetch package.json from the repo
  let pkgJson: PackageJson;
  try {
    const response = await githubRequest(
      (octokit) =>
        octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
          owner,
          repo,
          path: 'package.json',
        }).then(r => r.data),
      scanner,
    ) as { content?: string; encoding?: string };

    const content = Buffer.from(response.content ?? '', 'base64').toString('utf-8');
    pkgJson = JSON.parse(content) as PackageJson;
  } catch (err) {
    warn('Could not fetch package.json (may not be a Node.js project)', scanner);
    return { scanner, issues: [] };
  }

  const allDeps: Record<string, string> = {
    ...(pkgJson.dependencies    ?? {}),
    ...(pkgJson.devDependencies ?? {}),
  };

  const issues: DetectedIssue[] = [];

  for (const pack of activePacks) {
    const watchedPackages = DOMAIN_PACKAGES[pack.id] ?? [];
    const relevantDeps    = Object.entries(allDeps).filter(([name]) => watchedPackages.includes(name));

    for (const [name, declared] of relevantDeps) {
      const latest = await getLatestVersion(name);
      if (!latest) continue;

      const [declaredMajor, declaredMinor] = parseMajorMinor(declared);
      const [latestMajor,   latestMinor]   = parseMajorMinor(latest);

      const majorDrift = latestMajor - declaredMajor;
      const minorDrift = latestMajor === declaredMajor ? latestMinor - declaredMinor : 0;

      if (majorDrift < 1 && minorDrift < 3) {
        debug(`${name}: ${declared} vs latest ${latest} — within acceptable range`, scanner);
        continue;
      }

      const driftDescription = majorDrift >= 1
        ? `${majorDrift} major version(s) behind`
        : `${minorDrift} minor version(s) behind`;

      debug(`${name}: ${declared} declared, ${latest} latest — ${driftDescription}`, scanner);

      issues.push({
        repoOwner:   owner,
        repoName:    repo,
        domain:      pack.id,
        issueType:   'SDK_VERSION_DRIFT',
        severity:    majorDrift >= 1 ? 'HIGH' : 'MEDIUM',
        confidence:  0.95,
        sourceRef:   `dep:${name}`,
        evidence:    [`${name}@${declared} in package.json`, `Latest: ${name}@${latest}`, driftDescription],
        description: `${pack.name} SDK "${name}" is ${driftDescription} (declared: ${declared}, latest: ${latest})`,
        detectedAt:  new Date().toISOString(),
      });
    }
  }

  return { scanner, issues };
}
