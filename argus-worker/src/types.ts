// Shared TypeScript types for Argus Status Worker

// ---------------------------------------------------------------------------
// Config types (mirrors config.toml schema; written by generate-config.mjs)
// ---------------------------------------------------------------------------

export interface Settings {
  title: string;
  description: string;
  history_days: number;
}

interface MonitorBase {
  id: string;
  name: string;
  description: string;
  type: "http" | "websocket";
  url: string;
  timeout_ms: number;
}

export interface HttpMonitorConfig extends MonitorBase {
  type: "http";
  method: string;
  expect_status: number;
  follow_redirect: boolean;
  expect_json_path: string | null;
  expect_json_value: string | null;
}

export interface WebSocketMonitorConfig extends MonitorBase {
  type: "websocket";
  ws_check_mode: "connection" | "message" | "heartbeat";
  heartbeat_message: string | null;
  /** Zero-based index of the message to evaluate. Messages before this index are skipped. Default: 0. */
  heartbeat_message_index: number;
  expect_heartbeat_reply: string | null;
  expect_heartbeat_json_path: string | null;
  expect_heartbeat_json_value: string | null;
  heartbeat_timeout_ms: number;
}

export type MonitorConfig = HttpMonitorConfig | WebSocketMonitorConfig;

// ---------------------------------------------------------------------------
// Check result — produced by checker.ts for each monitor run
// ---------------------------------------------------------------------------

export interface CheckResult {
  /** Whether the monitor is considered up at this check. */
  up: boolean;
  /** Round-trip latency in milliseconds. Null if the check didn't reach the target. */
  response_ms: number | null;
  /** HTTP status code received (HTTP monitors only). */
  status_code: number | null;
  /** Human-readable reason when up=false. */
  reason: string | null;
  /** ISO 8601 timestamp of when this check ran. */
  checked_at: string;
}

// ---------------------------------------------------------------------------
// KV storage structures
// ---------------------------------------------------------------------------

/** Stored at key "status:current" in STATUS_KV */
export interface CurrentStatus {
  last_checked: string; // ISO 8601
  monitors: Record<string, CheckResult>;
}

/** Per-monitor aggregate for one calendar day */
export interface DailyAggregate {
  /** Total number of checks run on this day. */
  total: number;
  /** Number of checks that returned up=true. */
  up_count: number;
  /** Sum of all response_ms (for computing average). Null if no latency recorded. */
  response_ms_sum: number;
  /** Number of checks that contributed a response_ms value. */
  response_ms_count: number;
}

/** Stored at key "history:YYYY-MM-DD" in STATUS_KV */
export type DailyHistory = Record<string, DailyAggregate>;

// ---------------------------------------------------------------------------
// API response shapes (served to the frontend)
// ---------------------------------------------------------------------------

export interface MonitorPublicInfo {
  id: string;
  name: string;
  description: string;
  type: "http" | "websocket";
  url: string;
}

export interface ApiStatusResponse {
  last_checked: string | null;
  monitors: Record<
    string,
    CheckResult & {
      name: string;
      type: string;
    }
  >;
}

export interface ApiHistoryDay {
  date: string;
  monitors: Record<
    string,
    {
      total: number;
      up_count: number;
      uptime_pct: number;
      avg_response_ms: number | null;
    } | null
  >;
}
