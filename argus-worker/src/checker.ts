/**
 * Monitor checker — performs HTTP and WebSocket health checks.
 * All checks are side-effect-free (no KV access). Results are returned
 * as CheckResult objects for the caller to persist.
 */

import type {
  CheckResult,
  HttpMonitorConfig,
  MonitorConfig,
  WebSocketMonitorConfig,
} from "./types";

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// HTTP checker
// ---------------------------------------------------------------------------

export async function checkHttp(
  monitor: HttpMonitorConfig,
): Promise<CheckResult> {
  const start = Date.now();
  const checkedAt = now();

  try {
    const response = await fetch(monitor.url, {
      method: monitor.method,
      redirect: monitor.follow_redirect ? "follow" : "manual",
      signal: AbortSignal.timeout(monitor.timeout_ms),
    });

    const responseMs = Date.now() - start;

    if (response.status !== monitor.expect_status) {
      return {
        up: false,
        response_ms: responseMs,
        status_code: response.status,
        reason: `Expected status ${monitor.expect_status}, got ${response.status}`,
        checked_at: checkedAt,
      };
    }

    // Optional JSON body assertion
    if (
      monitor.expect_json_path !== null &&
      monitor.expect_json_value !== null
    ) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return {
          up: false,
          response_ms: responseMs,
          status_code: response.status,
          reason: "Expected JSON body but response was not valid JSON",
          checked_at: checkedAt,
        };
      }

      const actual = getJsonPath(body, monitor.expect_json_path);
      if (String(actual) !== monitor.expect_json_value) {
        return {
          up: false,
          response_ms: responseMs,
          status_code: response.status,
          reason: `JSON assertion failed: ${monitor.expect_json_path} = ${JSON.stringify(actual)}, expected "${monitor.expect_json_value}"`,
          checked_at: checkedAt,
        };
      }
    }

    return {
      up: true,
      response_ms: responseMs,
      status_code: response.status,
      reason: null,
      checked_at: checkedAt,
    };
  } catch (err: unknown) {
    const responseMs = Date.now() - start;
    const reason =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Timed out after ${monitor.timeout_ms}ms`
          : err.message
        : "Unknown error";

    return {
      up: false,
      response_ms: responseMs,
      status_code: null,
      reason,
      checked_at: checkedAt,
    };
  }
}

/**
 * Resolve a simple dot-separated path into an object.
 * e.g. getJsonPath({a:{b:"ok"}}, "a.b") => "ok"
 */
function getJsonPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ---------------------------------------------------------------------------
// WebSocket checker
// ---------------------------------------------------------------------------

export async function checkWebSocket(
  monitor: WebSocketMonitorConfig,
): Promise<CheckResult> {
  const start = Date.now();
  const checkedAt = now();

  const timeout =
    monitor.ws_check_mode === "heartbeat"
      ? monitor.heartbeat_timeout_ms
      : monitor.timeout_ms;

  try {
    const result = await Promise.race([
      doWebSocketCheck(monitor),
      sleep(timeout).then(() => ({ timedOut: true as const })),
    ]);

    const responseMs = Date.now() - start;

    if ("timedOut" in result) {
      return {
        up: false,
        response_ms: responseMs,
        status_code: null,
        reason: `Timed out after ${timeout}ms`,
        checked_at: checkedAt,
      };
    }

    return {
      up: result.up,
      response_ms: responseMs,
      status_code: null,
      reason: result.reason ?? null,
      checked_at: checkedAt,
    };
  } catch (err: unknown) {
    const responseMs = Date.now() - start;
    const reason = err instanceof Error ? err.message : "Unknown error";
    return {
      up: false,
      response_ms: responseMs,
      status_code: null,
      reason,
      checked_at: checkedAt,
    };
  }
}

type WsCheckOutcome = { up: boolean; reason?: string };

async function doWebSocketCheck(
  monitor: WebSocketMonitorConfig,
): Promise<WsCheckOutcome> {
  // CF Workers: connect to a WebSocket server by upgrading a fetch request.
  const resp = await fetch(monitor.url, {
    headers: { Upgrade: "websocket" },
  });

  if (resp.status !== 101) {
    return {
      up: false,
      reason: `WebSocket upgrade failed with status ${resp.status}`,
    };
  }

  const ws = resp.webSocket;
  if (!ws) {
    return { up: false, reason: "No webSocket on upgrade response" };
  }
  ws.accept();

  if (monitor.ws_check_mode === "connection") {
    ws.close(1000, "check complete");
    return { up: true };
  }

  // message or heartbeat
  return new Promise<WsCheckOutcome>((resolve) => {
    ws.addEventListener("error", () => {
      resolve({ up: false, reason: "WebSocket error event received" });
    });

    ws.addEventListener("close", (event: CloseEvent) => {
      if (event.code !== 1000 && event.code !== 1001) {
        resolve({
          up: false,
          reason: `WebSocket closed unexpectedly (code ${event.code})`,
        });
      }
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      const data = typeof event.data === "string" ? event.data : "";

      if (monitor.ws_check_mode === "message") {
        ws.close(1000, "check complete");
        resolve({ up: true });
        return;
      }

      // heartbeat mode — check reply
      if (
        monitor.expect_heartbeat_reply &&
        data.includes(monitor.expect_heartbeat_reply)
      ) {
        ws.close(1000, "check complete");
        resolve({ up: true });
      } else {
        ws.close(1000, "unexpected reply");
        resolve({
          up: false,
          reason: `Heartbeat reply mismatch: expected "${monitor.expect_heartbeat_reply}", got "${data.slice(0, 100)}"`,
        });
      }
    });

    if (monitor.ws_check_mode === "heartbeat" && monitor.heartbeat_message) {
      ws.send(monitor.heartbeat_message);
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Dispatcher — runs all checks in parallel
// ---------------------------------------------------------------------------

export async function runAllChecks(
  monitors: MonitorConfig[],
): Promise<Record<string, CheckResult>> {
  const results = await Promise.allSettled(
    monitors.map((m) => (m.type === "http" ? checkHttp(m) : checkWebSocket(m))),
  );

  const out: Record<string, CheckResult> = {};
  for (let i = 0; i < monitors.length; i++) {
    const m = monitors[i];
    const settled = results[i];
    if (settled.status === "fulfilled") {
      out[m.id] = settled.value;
    } else {
      out[m.id] = {
        up: false,
        response_ms: null,
        status_code: null,
        reason:
          settled.reason instanceof Error
            ? settled.reason.message
            : "Check threw unexpectedly",
        checked_at: now(),
      };
    }
  }
  return out;
}
