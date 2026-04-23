# Phase 6 — Web Researcher

**File:** `src/learner/webResearcher.ts`

## Objective

Use NeuroLink's AutoResearch capability to fetch and synthesise content from engineering blogs and CVE databases. AutoResearch follows links (depth 2), extracts relevant content, and synthesises it — no custom web scraper needed.

---

## Implementation

```typescript
// src/learner/webResearcher.ts
import { NeuroLink }           from '@juspay/neurolink';
import { ResearchDocument, LearningTopic } from './types.js';

/** Engineering blog base URLs per domain. */
const DOMAIN_BLOG_URLS: Record<string, string[]> = {
  payments: [
    'https://stripe.com/blog/idempotency',
    'https://engineering.razorpay.com',
    'https://medium.com/juspay-tech',
  ],
  security: [
    'https://security.googleblog.com',
    'https://owasp.org/www-project-top-ten/',
    'https://cheatsheetseries.owasp.org',
  ],
  reliability: [
    'https://netflixtechblog.com',
    'https://engineering.uber.com',
    'https://blog.cloudflare.com',
  ],
  compliance: [
    'https://gdpr.eu/article-17-right-to-be-forgotten/',
    'https://ico.org.uk/for-organisations/guide-to-data-protection/',
    'https://engineering.razorpay.com/privacy',
  ],
};

/**
 * Uses NeuroLink AutoResearch to fetch and synthesise blog content.
 */
export async function researchEngBlog(
  neurolink: NeuroLink,
  topic:     LearningTopic,
): Promise<ResearchDocument[]> {
  const urls = DOMAIN_BLOG_URLS[topic.domain] ?? [];
  if (urls.length === 0) return [];

  const docs: ResearchDocument[] = [];

  for (const baseUrl of urls.slice(0, 2)) { // max 2 blogs per run
    try {
      // NeuroLink AutoResearch: fetches page, follows links (depth 2), summarises
      const result = await neurolink.autoResearch({
        topic:    `${topic.topic} best practices`,
        seedUrls: [baseUrl],
        depth:    2,
        maxPages: 8,
        format:   'markdown',
      });

      if (!result.summary) continue;

      docs.push({
        title:   `${topic.topic} — ${new URL(baseUrl).hostname}`,
        url:     baseUrl,
        content: result.summary.slice(0, 4000),
        domain:  topic.domain,
        tags:    [topic.topic, topic.domain, 'engineering_blog'],
      });
    } catch {
      // AutoResearch failure is non-fatal — skip and continue
      continue;
    }
  }

  return docs;
}

/**
 * Searches NVD CVE database for domain-relevant vulnerabilities.
 */
export async function researchCVE(
  neurolink: NeuroLink,
  topic:     LearningTopic,
): Promise<ResearchDocument[]> {
  const keyword = encodeURIComponent(topic.topic);
  const url     = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${keyword}&resultsPerPage=5`;

  let cves: any[] = [];
  try {
    const resp = await fetch(url);
    const json = resp.ok ? await resp.json() : {};
    cves = json.vulnerabilities ?? [];
  } catch {
    return [];
  }

  if (cves.length === 0) return [];

  const cveSummary = cves.slice(0, 3).map((v: any) => {
    const cve = v.cve;
    return `CVE ID: ${cve.id}\nSeverity: ${cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseSeverity ?? 'N/A'}\nDescription: ${cve.descriptions?.[0]?.value ?? ''}`;
  }).join('\n\n---\n\n');

  const { text: summary } = await neurolink.generate({
    prompt: `Summarise these CVEs for developers. For each, explain what code pattern causes the vulnerability and how to fix it.

${cveSummary}

Return clean markdown, under 600 words total.`,
    provider: 'google',
    model:    'gemini-2.0-flash',
  });

  return [{
    title:   `CVE research: ${topic.topic}`,
    url:     `https://nvd.nist.gov/vuln/search/results?query=${encodeURIComponent(topic.topic)}`,
    content: summary,
    domain:  topic.domain,
    tags:    [topic.domain, 'cve', 'security'],
  }];
}
```

---

## NeuroLink AutoResearch

The `neurolink.autoResearch()` method is a built-in NeuroLink feature from the Juspay repo. It:
1. Fetches the seed URL
2. Extracts text content (strips HTML/CSS/scripts)
3. Identifies 3–5 relevant outbound links
4. Recursively fetches up to `depth` levels
5. Synthesises all content into a single `summary` string

If `autoResearch` is not available in the installed NeuroLink version, fall back to a single `neurolink.generate()` call with the URL text fetched via `fetch()`.
