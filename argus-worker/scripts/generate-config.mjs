#!/usr/bin/env node
/**
 * Build-time script: reads config.toml, validates it, and writes
 * src/_config.generated.ts which is bundled into the Worker.
 *
 * Run with:  node scripts/generate-config.mjs
 * Or via:    npm run generate-config
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "smol-toml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Read & parse
// ---------------------------------------------------------------------------
const tomlPath = resolve(root, "config.toml");
let raw;
try {
  raw = readFileSync(tomlPath, "utf8");
} catch {
  console.error(`[generate-config] Cannot read config.toml at ${tomlPath}`);
  process.exit(1);
}

let config;
try {
  config = parse(raw);
} catch (err) {
  console.error(`[generate-config] TOML parse error: ${err.message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Validate settings
// ---------------------------------------------------------------------------
const settings = config.settings ?? {};
const title = String(settings.title ?? "Argus Status");
const description = String(settings.description ?? "");
const historyDays = Number(settings.history_days ?? 14);

if (!Number.isInteger(historyDays) || historyDays < 1 || historyDays > 90) {
  console.error(
    "[generate-config] settings.history_days must be an integer between 1 and 90",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Validate monitors
// ---------------------------------------------------------------------------
const rawMonitors = Array.isArray(config.monitors) ? config.monitors : [];
if (rawMonitors.length === 0) {
  console.warn("[generate-config] Warning: no monitors defined in config.toml");
}

const VALID_TYPES = new Set(["http", "websocket"]);
const VALID_WS_MODES = new Set(["connection", "message", "heartbeat"]);
const VALID_HTTP_METHODS = new Set(["GET", "POST", "PUT", "HEAD", "OPTIONS"]);
const seenIds = new Set();

function normalizeWebSocketMessage(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

const monitors = rawMonitors.map((m, idx) => {
  const label = `monitors[${idx}]`;

  if (!m.id || typeof m.id !== "string")
    fatal(`${label}: 'id' is required and must be a string`);
  if (!/^[a-zA-Z0-9_-]+$/.test(m.id))
    fatal(
      `${label}: 'id' must only contain letters, numbers, hyphens, underscores`,
    );
  if (seenIds.has(m.id)) fatal(`${label}: duplicate id "${m.id}"`);
  seenIds.add(m.id);

  if (!m.name || typeof m.name !== "string")
    fatal(`${label}: 'name' is required and must be a string`);
  if (!m.url || typeof m.url !== "string")
    fatal(`${label}: 'url' is required and must be a string`);

  const type = String(m.type ?? "http").toLowerCase();
  if (!VALID_TYPES.has(type))
    fatal(`${label}: 'type' must be "http" or "websocket", got "${m.type}"`);

  const timeoutMs = Number(m.timeout_ms ?? 10000);

  /** @type {Record<string, unknown>} */
  const base = {
    id: m.id,
    name: m.name,
    description: m.description ? String(m.description) : "",
    type,
    url: m.url,
    timeout_ms: timeoutMs,
  };

  if (type === "http") {
    const method = String(m.method ?? "GET").toUpperCase();
    if (!VALID_HTTP_METHODS.has(method))
      fatal(`${label}: unsupported HTTP method "${m.method}"`);

    const expectStatus = Number(m.expect_status ?? 200);

    return {
      ...base,
      method,
      expect_status: expectStatus,
      follow_redirect: Boolean(m.follow_redirect ?? false),
      expect_json_path: m.expect_json_path ? String(m.expect_json_path) : null,
      expect_json_value:
        m.expect_json_value !== undefined ? String(m.expect_json_value) : null,
    };
  }

  // websocket
  const wsCheckMode = String(m.ws_check_mode ?? "connection").toLowerCase();
  if (!VALID_WS_MODES.has(wsCheckMode)) {
    fatal(
      `${label}: 'ws_check_mode' must be "connection", "message", or "heartbeat", got "${m.ws_check_mode}"`,
    );
  }

  if (wsCheckMode === "heartbeat") {
    if (!m.heartbeat_message)
      fatal(
        `${label}: 'heartbeat_message' is required for ws_check_mode = "heartbeat"`,
      );
    const hasReplySubstring =
      m.expect_heartbeat_reply !== undefined && m.expect_heartbeat_reply !== null;
    const hasReplyJsonMatcher =
      m.expect_heartbeat_json_path !== undefined &&
      m.expect_heartbeat_json_path !== null &&
      m.expect_heartbeat_json_value !== undefined &&
      m.expect_heartbeat_json_value !== null;

    if (!hasReplySubstring && !hasReplyJsonMatcher)
      fatal(
        `${label}: heartbeat mode requires either 'expect_heartbeat_reply' or both 'expect_heartbeat_json_path' and 'expect_heartbeat_json_value'`,
      );
  }

  return {
    ...base,
    ws_check_mode: wsCheckMode,
    heartbeat_message: normalizeWebSocketMessage(m.heartbeat_message),
    heartbeat_message_index: Number(m.heartbeat_message_index ?? 0),
    expect_heartbeat_reply: m.expect_heartbeat_reply
      ? String(m.expect_heartbeat_reply)
      : null,
    expect_heartbeat_json_path: m.expect_heartbeat_json_path
      ? String(m.expect_heartbeat_json_path)
      : null,
    expect_heartbeat_json_value:
      m.expect_heartbeat_json_value !== undefined
        ? String(m.expect_heartbeat_json_value)
        : null,
    heartbeat_timeout_ms: Number(m.heartbeat_timeout_ms ?? 5000),
  };
});

function fatal(msg) {
  console.error(`[generate-config] Validation error: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Emit TypeScript
// ---------------------------------------------------------------------------
const output = `// AUTO-GENERATED by scripts/generate-config.mjs — DO NOT EDIT
// Edit config.toml and run: npm run generate-config

import type { MonitorConfig, Settings } from './types';

export const settings: Settings = ${JSON.stringify({ title, description, history_days: historyDays }, null, 2)};

export const monitors: MonitorConfig[] = ${JSON.stringify(monitors, null, 2)};
`;

const outPath = resolve(root, "src", "_config.generated.ts");
writeFileSync(outPath, output, "utf8");
console.log(
  `[generate-config] Written ${monitors.length} monitor(s) to src/_config.generated.ts`,
);
