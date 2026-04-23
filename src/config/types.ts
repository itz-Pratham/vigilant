// src/config/types.ts

/**
 * The full configuration for a vigilant installation.
 * Loaded from ~/.vigilant/config.json and merged with env vars at startup.
 * Env vars always take precedence over the config file.
 */
export type VigilantConfig = {
  /** GitHub Personal Access Token — needs Contents, Pull Requests, Issues, Workflows (R/W) */
  githubToken: string;

  /** Google Gemini API key — primary AI provider (free tier available) */
  geminiApiKey?: string;

  /** Groq API key — fallback AI provider (free tier available) */
  groqApiKey?: string;

  /** OpenAI API key — optional additional fallback */
  openaiApiKey?: string;

  /** Ollama base URL — for fully local inference, e.g. "http://localhost:11434" */
  ollamaBaseUrl?: string;

  /**
   * Repos watched when `vigilant start` is called with no --repo flag.
   * Format: ["owner/repo", "owner/repo2"]
   */
  defaultRepos: string[];

  /**
   * How often the watcher tick runs, in seconds.
   * Default: 60. Minimum enforced: 30.
   */
  watchIntervalSeconds: number;

  /**
   * Active domain packs. At least one required.
   * Valid values: "payments" | "security" | "reliability" | "compliance"
   */
  domains: string[];

  /**
   * Maximum agentic loop iterations before marking a session blocked.
   * Default: 20.
   */
  maxIterations: number;

  /**
   * When true, PRs are merged automatically when CI passes — Gate 2 is skipped.
   * Default: false.
   */
  autoMerge: boolean;
};

/** Raw JSON shape on disk — all fields optional so partial configs can load */
export type RawConfig = Partial<VigilantConfig>;

/** Typed result of config validation */
export type ConfigValidationResult =
  | { valid: true;  config: VigilantConfig }
  | { valid: false; error: string };
