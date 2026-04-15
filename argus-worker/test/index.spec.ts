import {
  createExecutionContext,
  createScheduledController,
  env,
  fetchMock,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import worker from "../src";
import { dateKey, updateDailyHistory } from "../src/kv-storage";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
  path: string,
  method = "GET",
): Request<unknown, IncomingRequestCfProperties> {
  return new Request<unknown, IncomingRequestCfProperties>(
    `http://example.com${path}`,
    { method },
  );
}

async function workerFetch(path: string, method = "GET"): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(makeRequest(path, method), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

// ---------------------------------------------------------------------------
// /api/config
// ---------------------------------------------------------------------------

describe("GET /api/config", () => {
  it("returns monitor metadata", async () => {
    const res = await workerFetch("/api/config");
    expect(res.status).toBe(200);
    const body = await res.json<{
      title: string;
      monitors: Array<{ id: string; type: string }>;
    }>();
    expect(typeof body.title).toBe("string");
    expect(Array.isArray(body.monitors)).toBe(true);
    for (const m of body.monitors) {
      expect(typeof m.id).toBe("string");
      expect(["http", "websocket"]).toContain(m.type);
    }
  });

  it("sets CORS headers", async () => {
    const res = await workerFetch("/api/config");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

// ---------------------------------------------------------------------------
// /api/status (empty KV / first run)
// ---------------------------------------------------------------------------

describe("GET /api/status", () => {
  it("returns a valid response with no prior data", async () => {
    const res = await workerFetch("/api/status");
    expect(res.status).toBe(200);
    const body = await res.json<{
      last_checked: null;
      monitors: Record<string, unknown>;
    }>();
    expect(body.last_checked).toBeNull();
    expect(typeof body.monitors).toBe("object");
  });

  it("returns 404 for unknown monitor ID", async () => {
    const res = await workerFetch("/api/status/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("returns 405 for non-GET", async () => {
    const res = await workerFetch("/api/status", "POST");
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// /api/status after seeding KV with mock data
// ---------------------------------------------------------------------------

describe("GET /api/status with seeded KV", () => {
  const ts = "2026-04-15T12:00:00.000Z";

  beforeAll(async () => {
    await env.STATUS_KV.put(
      "status:current",
      JSON.stringify({
        last_checked: ts,
        monitors: {
          cloudflare: {
            up: true,
            response_ms: 42,
            status_code: 200,
            reason: null,
            checked_at: ts,
          },
        },
      }),
    );
  });

  it("returns the seeded status", async () => {
    const res = await workerFetch("/api/status");
    expect(res.status).toBe(200);
    const body = await res.json<{
      last_checked: string;
      monitors: Record<string, { up: boolean }>;
    }>();
    expect(body.last_checked).toBe(ts);
    expect(body.monitors["cloudflare"]?.up).toBe(true);
  });

  it("returns single monitor status", async () => {
    const res = await workerFetch("/api/status/cloudflare");
    expect(res.status).toBe(200);
    const body = await res.json<{ id: string; result: { up: boolean } }>();
    expect(body.id).toBe("cloudflare");
    expect(body.result.up).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// /api/history
// ---------------------------------------------------------------------------

describe("GET /api/history", () => {
  it("returns history shape", async () => {
    const res = await workerFetch("/api/history");
    expect(res.status).toBe(200);
    const body = await res.json<{ history_days: number; days: unknown[] }>();
    expect(typeof body.history_days).toBe("number");
    expect(Array.isArray(body.days)).toBe(true);
  });

  it("returns 404 for unknown monitor", async () => {
    const res = await workerFetch("/api/history/does-not-exist");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// KV storage unit tests
// ---------------------------------------------------------------------------

describe("kv-storage: dateKey", () => {
  it("formats as YYYY-MM-DD", () => {
    const d = new Date("2026-04-15T10:30:00.000Z");
    expect(dateKey(d)).toBe("2026-04-15");
  });
});

describe("kv-storage: updateDailyHistory", () => {
  it("accumulates check counts", async () => {
    const date = "2026-04-15";
    const results = {
      cloudflare: {
        up: true,
        response_ms: 50,
        status_code: 200,
        reason: null,
        checked_at: "2026-04-15T10:00:00Z",
      },
    };

    // First update
    await updateDailyHistory(env.STATUS_KV, date, results);
    // Second update (same day)
    await updateDailyHistory(env.STATUS_KV, date, results);

    const raw = await env.STATUS_KV.get(`history:${date}`);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw as string) as Record<
      string,
      { total: number; up_count: number }
    >;
    expect(stored["cloudflare"].total).toBe(2);
    expect(stored["cloudflare"].up_count).toBe(2);
  });

  it("counts downs correctly", async () => {
    const date = "2026-04-16";
    await updateDailyHistory(env.STATUS_KV, date, {
      cloudflare: {
        up: false,
        response_ms: null,
        status_code: 503,
        reason: "down",
        checked_at: "",
      },
    });
    await updateDailyHistory(env.STATUS_KV, date, {
      cloudflare: {
        up: true,
        response_ms: 55,
        status_code: 200,
        reason: null,
        checked_at: "",
      },
    });

    const raw = await env.STATUS_KV.get(`history:${date}`);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw as string) as Record<
      string,
      { total: number; up_count: number }
    >;
    expect(stored["cloudflare"].total).toBe(2);
    expect(stored["cloudflare"].up_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CORS pre-flight
// ---------------------------------------------------------------------------

describe("OPTIONS pre-flight", () => {
  it("responds 204 with CORS headers", async () => {
    const ctx = createExecutionContext();
    const req = new Request<unknown, IncomingRequestCfProperties>(
      "http://example.com/api/status",
      {
        method: "OPTIONS",
      },
    );
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});

// ---------------------------------------------------------------------------
// Unknown /api/* path
// ---------------------------------------------------------------------------

describe("unknown /api/* path", () => {
  it("returns 404", async () => {
    const res = await workerFetch("/api/not-a-real-path");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Scheduled handler
// ---------------------------------------------------------------------------

describe("scheduled handler", () => {
  afterEach(() => {
    fetchMock.deactivate();
  });

  it("writes check results to KV", async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    fetchMock
      .get("https://www.cloudflare.com")
      .intercept({ path: "/", method: "GET" })
      .reply(200, "OK");
    fetchMock
      .get("https://developers.cloudflare.com")
      .intercept({ path: "/workers/", method: "GET" })
      .reply(200, "OK");

    const ctx = createExecutionContext();
    await worker.scheduled(
      createScheduledController({ scheduledTime: Date.now(), cron: "*/30 * * * *" }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    const raw = await env.STATUS_KV.get("status:current");
    expect(raw).not.toBeNull();
    const status = JSON.parse(raw as string) as {
      last_checked: string;
      monitors: Record<string, { up: boolean }>;
    };
    expect(typeof status.last_checked).toBe("string");
    expect(typeof status.monitors).toBe("object");
    expect("cloudflare" in status.monitors).toBe(true);
    expect("workers-docs" in status.monitors).toBe(true);
  });

  it("marks monitor as down on non-200 response", async () => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
    fetchMock
      .get("https://www.cloudflare.com")
      .intercept({ path: "/", method: "GET" })
      .reply(503, "Service Unavailable");
    fetchMock
      .get("https://developers.cloudflare.com")
      .intercept({ path: "/workers/", method: "GET" })
      .reply(200, "OK");

    const ctx = createExecutionContext();
    await worker.scheduled(
      createScheduledController({ scheduledTime: Date.now(), cron: "*/30 * * * *" }),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    const raw = await env.STATUS_KV.get("status:current");
    expect(raw).not.toBeNull();
    const status = JSON.parse(raw as string) as {
      monitors: Record<string, { up: boolean }>;
    };
    expect(status.monitors["cloudflare"]?.up).toBe(false);
    expect(status.monitors["workers-docs"]?.up).toBe(true);
  });
});
