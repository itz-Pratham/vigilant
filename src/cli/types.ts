// src/cli/types.ts

export type StartOptions = {
  repo:      string;
  domain?:   string;
  interval?: string;
};

export type ServeOptions = {
  port?: string;
  host?: string;
};

export type LearnOptions = {
  topic:   string;
  domain?: string;
  repo?:   string;
};

export type StatusOptions = {
  repo?: string;
  all?:  boolean;
};
