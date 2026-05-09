// src/learner/webResearcher.ts
// Fetches web content from engineering blogs and CVE databases, then summarises with NeuroLink.
// No autoResearch API available — uses fetch() + neurolink.generate().

import { NeuroLink }                      from '@juspay/neurolink';
import type { LearningTopic, ResearchDocument } from './types.js';

// ── Blog URL registry ─────────────────────────────────────────────────────────

const DOMAIN_BLOG_URLS: Record<string, string[]> = {
  payments: [
    'https://stripe.com/blog/idempotency',
    'https://medium.com/juspay-tech',
  ],
  security: [
    'https://owasp.org/www-project-top-ten/',
    'https://cheatsheetseries.owasp.org/cheatsheets/NodeJS_Docker_Cheat_Sheet.html',
  ],
  reliability: [
    'https://netflixtechblog.com',
    'https://engineering.uber.com',
  ],
  compliance: [
    'https://gdpr.eu/article-17-right-to-be-forgotten/',
    'https://ico.org.uk/for-organisations/guide-to-data-protection/',
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Strip HTML tags and collapse whitespace, returning plain text. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);
}

/** Fetch a URL and return plain text. Returns null on network error. */
async function fetchText(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'vigilant-learner/1.0 (github.com/itz-Pratham/vigilant)' },
      signal:  AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    const ct   = resp.headers.get('content-type') ?? '';
    const text = ct.includes('text/html') ? stripHtml(await resp.text()) : await resp.text();
    return text.slice(0, 6000);
  } catch {
    return null;
  }
}

// ── Engineering blog researcher ───────────────────────────────────────────────

/**
 * Fetches up to 2 engineering blog pages related to the topic and summarises them.
 */
export async function researchEngBlog(
  neurolink: NeuroLink,
  topic:     LearningTopic,
): Promise<ResearchDocument[]> {
  const urls = (DOMAIN_BLOG_URLS[topic.domain] ?? []).slice(0, 2);
  if (urls.length === 0) return [];

  const docs: ResearchDocument[] = [];

  for (const url of urls) {
    const pageText = await fetchText(url);
    if (!pageText) continue;

    try {
      const result = await neurolink.generate({
        input: {
          text: `You are a technical educator. Summarise the following web page content for a developer learning about "${topic.topic}". Extract the most actionable best practices and code patterns.\n\nPage URL: ${url}\n\nPage content:\n${pageText}\n\nReturn clean markdown under 400 words.`,
        },
        disableTools: true,
      });

      docs.push({
        title:      `${topic.topic} — ${new URL(url).hostname}`,
        url,
        content:    result.content.slice(0, 4000),
        domain:     topic.domain,
        sourceType: 'engineering_blog',
        tags:       [topic.topic, topic.domain, 'engineering_blog', new URL(url).hostname],
      });
    } catch {
      /* generation failure is non-fatal */
    }
  }

  return docs;
}

// ── CVE researcher ────────────────────────────────────────────────────────────

/**
 * Searches the NVD CVE database for vulnerabilities matching the topic keyword.
 * Summarises the top 3 results with NeuroLink.
 */
export async function researchCVE(
  neurolink: NeuroLink,
  topic:     LearningTopic,
): Promise<ResearchDocument[]> {
  const keyword = encodeURIComponent(topic.topic);
  const apiUrl  = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${keyword}&resultsPerPage=5`;

  let cveText: string;
  try {
    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': 'vigilant-learner/1.0' },
      signal:  AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return [];
    const json = await resp.json() as { vulnerabilities?: unknown[] };
    const vulns = (json.vulnerabilities ?? []).slice(0, 3);
    if (vulns.length === 0) return [];

    cveText = vulns.map((v: unknown) => {
      const cve     = (v as Record<string, unknown>)['cve'] as Record<string, unknown>;
      const id      = cve['id'] as string;
      const descs   = cve['descriptions'] as Array<{ lang: string; value: string }>;
      const metrics = cve['metrics'] as Record<string, unknown> | undefined;
      const score   = (metrics?.['cvssMetricV31'] as Array<{ cvssData: { baseSeverity: string } }>)?.[0]?.cvssData?.baseSeverity ?? 'N/A';
      const desc    = (descs?.find(d => d.lang === 'en')?.value ?? '').slice(0, 500);
      return `CVE ID: ${id}\nSeverity: ${score}\nDescription: ${desc}`;
    }).join('\n\n---\n\n');
  } catch {
    return [];
  }

  try {
    const result = await neurolink.generate({
      input: {
        text: `Summarise these CVEs for ${topic.domain} developers. For each, explain the vulnerable code pattern and the secure fix in TypeScript/Node.js.\n\n${cveText}\n\nReturn clean markdown under 500 words.`,
      },
      disableTools: true,
    });

    return [{
      title:      `CVE research: ${topic.topic}`,
      url:        `https://nvd.nist.gov/vuln/search/results?query=${encodeURIComponent(topic.topic)}`,
      content:    result.content.slice(0, 4000),
      domain:     topic.domain,
      sourceType: 'cve_database',
      tags:       [topic.domain, 'cve', 'security', topic.topic],
    }];
  } catch {
    return [];
  }
}
