/**
 * KV storage helpers for Argus Status Worker.
 *
 * Key schema:
 *   "status:current"       → CurrentStatus (latest check results for all monitors)
 *   "history:YYYY-MM-DD"   → DailyHistory  (per-monitor daily aggregates)
 */

import type {
  CheckResult,
  CurrentStatus,
  DailyAggregate,
  DailyHistory,
} from "./types";

// ---------------------------------------------------------------------------
// Current status
// ---------------------------------------------------------------------------

export async function getCurrentStatus(
  kv: KVNamespace,
): Promise<CurrentStatus | null> {
  const raw = await kv.get("status:current");
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as CurrentStatus;
  } catch {
    return null;
  }
}

export async function saveCurrentStatus(
  kv: KVNamespace,
  lastChecked: string,
  results: Record<string, CheckResult>,
): Promise<void> {
  const data: CurrentStatus = {
    last_checked: lastChecked,
    monitors: results,
  };
  await kv.put("status:current", JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Daily history
// ---------------------------------------------------------------------------

/** Returns the "YYYY-MM-DD" key for a given Date in UTC. */
export function dateKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function getDailyHistory(
  kv: KVNamespace,
  date: string,
): Promise<DailyHistory | null> {
  const raw = await kv.get(`history:${date}`);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as DailyHistory;
  } catch {
    return null;
  }
}

/**
 * Merge a fresh set of CheckResults into today's DailyHistory entry and persist it.
 * Called once per cron run.
 */
export async function updateDailyHistory(
  kv: KVNamespace,
  date: string,
  results: Record<string, CheckResult>,
): Promise<void> {
  const existing = (await getDailyHistory(kv, date)) ?? {};

  for (const [id, result] of Object.entries(results)) {
    const prev: DailyAggregate = existing[id] ?? {
      total: 0,
      up_count: 0,
      response_ms_sum: 0,
      response_ms_count: 0,
    };

    existing[id] = {
      total: prev.total + 1,
      up_count: prev.up_count + (result.up ? 1 : 0),
      response_ms_sum: prev.response_ms_sum + (result.response_ms ?? 0),
      response_ms_count:
        prev.response_ms_count + (result.response_ms !== null ? 1 : 0),
    };
  }

  // Daily history stored for 90 days in KV (configured TTL per key)
  await kv.put(`history:${date}`, JSON.stringify(existing), {
    expirationTtl: 90 * 24 * 60 * 60,
  });
}

/**
 * Retrieve daily history for the last `days` days for the given monitor IDs.
 * Returns an array of { date, monitors } objects sorted oldest-first.
 */
export async function getHistoryRange(
  kv: KVNamespace,
  monitorIds: string[],
  days: number,
): Promise<
  Array<{ date: string; monitors: Record<string, DailyAggregate | null> }>
> {
  // Build date list (oldest first)
  const dates: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(dateKey(d));
  }

  // Fetch all day keys in parallel
  const fetched = await Promise.all(
    dates.map((date) => getDailyHistory(kv, date)),
  );

  return dates.map((date, idx) => {
    const day = fetched[idx];
    const monitors: Record<string, DailyAggregate | null> = {};
    for (const id of monitorIds) {
      monitors[id] = day?.[id] ?? null;
    }
    return { date, monitors };
  });
}
