// src/db/queries/watcher.ts

import { getStateDb } from '../index.js';

export type WatcherState = {
  repoOwner:      string;
  repoName:       string;
  scannerName:    string;
  lastEtag:       string | null;
  lastCheckedAt:  string;
};

export function getWatcherState(
  repoOwner:   string,
  repoName:    string,
  scannerName: string,
): WatcherState | null {
  const db  = getStateDb();
  const row = db.prepare(`
    SELECT * FROM watcher_state
    WHERE repo_owner = ? AND repo_name = ? AND scanner_name = ?
  `).get(repoOwner, repoName, scannerName) as Record<string, unknown> | undefined;

  if (!row) return null;
  return {
    repoOwner:     row['repo_owner']      as string,
    repoName:      row['repo_name']       as string,
    scannerName:   row['scanner_name']    as string,
    lastEtag:      row['last_etag']       as string | null,
    lastCheckedAt: row['last_checked_at'] as string,
  };
}

export function upsertWatcherState(state: WatcherState): void {
  const db = getStateDb();
  db.prepare(`
    INSERT INTO watcher_state (repo_owner, repo_name, scanner_name, last_etag, last_checked_at)
    VALUES (@repoOwner, @repoName, @scannerName, @lastEtag, @lastCheckedAt)
    ON CONFLICT (repo_owner, repo_name, scanner_name)
    DO UPDATE SET
      last_etag       = excluded.last_etag,
      last_checked_at = excluded.last_checked_at
  `).run({
    repoOwner:     state.repoOwner,
    repoName:      state.repoName,
    scannerName:   state.scannerName,
    lastEtag:      state.lastEtag,
    lastCheckedAt: state.lastCheckedAt,
  });
}
