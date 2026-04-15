import { describe, expect, it } from "vitest";
import {
  evaluateHeartbeatReply,
  toWebSocketUpgradeUrl,
} from "../src/checker";
import type { WebSocketMonitorConfig } from "../src/types";

function makeHeartbeatMonitor(
  overrides: Partial<WebSocketMonitorConfig> = {},
): WebSocketMonitorConfig {
  return {
    id: "ws",
    name: "WS",
    description: "",
    type: "websocket",
    url: "wss://example.com/ws",
    timeout_ms: 10000,
    ws_check_mode: "heartbeat",
    heartbeat_message: "ping",
    expect_heartbeat_reply: null,
    expect_heartbeat_json_path: null,
    expect_heartbeat_json_value: null,
    heartbeat_timeout_ms: 5000,
    ...overrides,
  };
}

describe("toWebSocketUpgradeUrl", () => {
  it("converts wss URLs to https URLs for fetch upgrades", () => {
    expect(
      toWebSocketUpgradeUrl("wss://staging.apimonaco.xyz/ws?token=abc"),
    ).toBe("https://staging.apimonaco.xyz/ws?token=abc");
  });

  it("converts ws URLs to http URLs for fetch upgrades", () => {
    expect(toWebSocketUpgradeUrl("ws://localhost:8787/socket")).toBe(
      "http://localhost:8787/socket",
    );
  });

  it("leaves http and https URLs unchanged", () => {
    expect(toWebSocketUpgradeUrl("https://example.com/ws")).toBe(
      "https://example.com/ws",
    );
    expect(toWebSocketUpgradeUrl("http://example.com/ws")).toBe(
      "http://example.com/ws",
    );
  });
});

describe("evaluateHeartbeatReply", () => {
  it("matches a JSON reply by path and value", () => {
    const result = evaluateHeartbeatReply(
      makeHeartbeatMonitor({
        expect_heartbeat_json_path: "type",
        expect_heartbeat_json_value: "PONG",
      }),
      '{"type":"PONG"}',
    );

    expect(result).toEqual({ up: true });
  });

  it("fails when the JSON reply does not match the configured field", () => {
    const result = evaluateHeartbeatReply(
      makeHeartbeatMonitor({
        expect_heartbeat_json_path: "type",
        expect_heartbeat_json_value: "PONG",
      }),
      '{"type":"PING"}',
    );

    expect(result.up).toBe(false);
    expect(result.reason).toContain("Heartbeat JSON assertion failed");
  });

  it("falls back to substring matching for plain string replies", () => {
    const result = evaluateHeartbeatReply(
      makeHeartbeatMonitor({
        expect_heartbeat_reply: "pong",
      }),
      "server:pong",
    );

    expect(result).toEqual({ up: true });
  });
});
