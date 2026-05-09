// src/learner/types.ts

/**
 * Where to search for a topic — maps to the source_type column in learning_topics.
 * These map onto the SourceType values used by knowledge_documents:
 *   github_prs | github_advisories  →  'github_repo'
 *   engineering_blog | cve_database →  'web'
 */
export type LearnerSourceType =
  | 'github_prs'
  | 'github_advisories'
  | 'engineering_blog'
  | 'cve_database';

/** One entry in the learning_topics SQLite table. */
export type LearningTopic = {
  id:               string;
  domain:           string;
  topic:            string;
  sourceType:       LearnerSourceType;
  lastResearchedAt: string | null;
  researchCount:    number;
};

/** One document produced by a research run — ready to be stored in knowledge_documents. */
export type ResearchDocument = {
  title:      string;
  url:        string;
  content:    string;   // summarised markdown, max 4 000 chars
  domain:     string;
  sourceType: LearnerSourceType;
  tags:       string[];
};

/** Aggregate result returned by runLearner() after one research job. */
export type ResearchResult = {
  topic:       string;
  sourceType:  LearnerSourceType;
  documents:   ResearchDocument[];
  durationMs:  number;
  itemsAdded:  number;
};

/** Options passed to runLearner(). */
export type LearnerOptions = {
  /** Override queue with a specific topic string (used by `vigilant learn --topic`). */
  topicOverride?: string;
  /** Restrict to one domain (used by `vigilant learn --domain`). */
  domain?:        string;
  /**
   * Scope for stored documents.
   * 'global' = best-practice docs available to all repos.
   * 'repo:owner/name' = scoped to one repo (used by `vigilant learn --repo`).
   */
  scope?:         string;
  /** Gemini API key — passed explicitly so NeuroLink doesn't need GOOGLE_AI_API_KEY in env. */
  geminiApiKey?:  string;
};
