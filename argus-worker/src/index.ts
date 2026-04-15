/**
 * Argus Status Worker — main entry point.
 *
 * Routes:
 *   GET /api/status          → current status of all monitors
 *   GET /api/status/:id      → current status of one monitor
 *   GET /api/history         → daily aggregates for all monitors (last N days)
 *   GET /api/history/:id     → daily aggregates for one monitor
 *   GET /api/config          → public monitor metadata
 *
 * Scheduled handler (cron):
 *   Runs all checks in parallel, persists results to STATUS_KV.
 */

import { monitors, settings } from "./_config.generated";
import { runAllChecks } from "./checker";
import {
  dateKey,
  getCurrentStatus,
  getHistoryRange,
  saveCurrentStatus,
  updateDailyHistory,
} from "./kv-storage";
import type { ApiHistoryDay, ApiStatusResponse } from "./types";

// ---------------------------------------------------------------------------
// CORS headers — allow the frontend to call the API from any origin
// ---------------------------------------------------------------------------
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function notFound(msg = "Not Found"): Response {
  return jsonResponse({ error: msg }, 404);
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  // CORS pre-flight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // ---- /api/config --------------------------------------------------------
  if (pathname === "/api/config") {
    return jsonResponse({
      title: settings.title,
      description: settings.description,
      monitors: monitors.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        type: m.type,
        url: m.url,
      })),
    });
  }

  // ---- /api/status --------------------------------------------------------
  if (pathname === "/api/status" || pathname === "/api/status/") {
    const current = await getCurrentStatus(env.STATUS_KV);
    const response: ApiStatusResponse = {
      last_checked: current?.last_checked ?? null,
      monitors: {},
    };
    for (const m of monitors) {
      const result = current?.monitors[m.id] ?? null;
      response.monitors[m.id] = {
        name: m.name,
        type: m.type,
        up: result?.up ?? false,
        response_ms: result?.response_ms ?? null,
        status_code: result?.status_code ?? null,
        reason: result?.reason ?? null,
        checked_at: result?.checked_at ?? "",
      };
    }
    return jsonResponse(response);
  }

  // ---- /api/status/:id ----------------------------------------------------
  const statusMatch = pathname.match(/^\/api\/status\/([a-zA-Z0-9_-]+)$/);
  if (statusMatch) {
    const id = statusMatch[1];
    const monitor = monitors.find((m) => m.id === id);
    if (!monitor) return notFound(`Monitor "${id}" not found`);

    const current = await getCurrentStatus(env.STATUS_KV);
    const result = current?.monitors[id] ?? null;
    return jsonResponse({
      id,
      name: monitor.name,
      type: monitor.type,
      last_checked: current?.last_checked ?? null,
      result,
    });
  }

  // ---- /api/history -------------------------------------------------------
  if (pathname === "/api/history" || pathname === "/api/history/") {
    const monitorIds = monitors.map((m) => m.id);
    const history = await getHistoryRange(
      env.STATUS_KV,
      monitorIds,
      settings.history_days,
    );

    const days: ApiHistoryDay[] = history.map(
      ({ date, monitors: dayMonitors }) => ({
        date,
        monitors: Object.fromEntries(
          Object.entries(dayMonitors).map(([id, agg]) => [
            id,
            agg
              ? {
                  total: agg.total,
                  up_count: agg.up_count,
                  uptime_pct:
                    agg.total > 0
                      ? Math.round((agg.up_count / agg.total) * 1000) / 10
                      : 0,
                  avg_response_ms:
                    agg.response_ms_count > 0
                      ? Math.round(agg.response_ms_sum / agg.response_ms_count)
                      : null,
                }
              : null,
          ]),
        ),
      }),
    );

    return jsonResponse({ history_days: settings.history_days, days });
  }

  // ---- /api/history/:id ---------------------------------------------------
  const histMatch = pathname.match(/^\/api\/history\/([a-zA-Z0-9_-]+)$/);
  if (histMatch) {
    const id = histMatch[1];
    const monitor = monitors.find((m) => m.id === id);
    if (!monitor) return notFound(`Monitor "${id}" not found`);

    const history = await getHistoryRange(
      env.STATUS_KV,
      [id],
      settings.history_days,
    );
    const days = history.map(({ date, monitors: dayMonitors }) => {
      const agg = dayMonitors[id];
      return {
        date,
        total: agg?.total ?? 0,
        up_count: agg?.up_count ?? 0,
        uptime_pct:
          agg && agg.total > 0
            ? Math.round((agg.up_count / agg.total) * 1000) / 10
            : null,
        avg_response_ms:
          agg && agg.response_ms_count > 0
            ? Math.round(agg.response_ms_sum / agg.response_ms_count)
            : null,
      };
    });

    return jsonResponse({
      id,
      name: monitor.name,
      history_days: settings.history_days,
      days,
    });
  }

  // All unmatched paths
  return notFound();
}

// ---------------------------------------------------------------------------
// Scheduled handler (cron trigger)
// ---------------------------------------------------------------------------

async function handleScheduled(env: Env): Promise<void> {
  const results = await runAllChecks(monitors);
  const ts = new Date().toISOString();
  const today = dateKey();

  await Promise.all([
    saveCurrentStatus(env.STATUS_KV, ts, results),
    updateDailyHistory(env.STATUS_KV, today, results),
  ]);
}

// ---------------------------------------------------------------------------
// Worker export
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      handleScheduled(env).catch((err: unknown) => {
        console.error(
          "[argus] Scheduled check failed:",
          err instanceof Error ? err.stack : String(err),
        );
      }),
    );
  },
} satisfies ExportedHandler<Env>;
