/**
 * Unit tests for Logger
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Logger } from "../../src/utils/logger.js";
import type { LogEntry } from "../../src/utils/log-types.js";

describe("Logger", () => {
  let logFile: string;

  beforeEach(() => {
    const dir = join(tmpdir(), "cc-glm-test-" + Date.now());
    mkdirSync(dir, { recursive: true });
    logFile = join(dir, "test.jsonl");
  });

  afterEach(() => {
    if (existsSync(logFile)) {
      unlinkSync(logFile);
    }
  });

  it("writes JSONL entries to file", () => {
    const logger = new Logger({ level: "debug" }, { logFilePath: logFile, stderr: false });
    logger.info("test message");

    const content = readFileSync(logFile, "utf-8").trim();
    const entry = JSON.parse(content) as LogEntry;

    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("test message");
    expect(entry.ts).toBeDefined();
  });

  it("respects log level filtering", () => {
    const logger = new Logger({ level: "warn" }, { logFilePath: logFile, stderr: false });
    logger.debug("should not appear");
    logger.info("should not appear");
    logger.warn("should appear");
    logger.error("should also appear");

    const lines = readFileSync(logFile, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const entry1 = JSON.parse(lines[0]) as LogEntry;
    const entry2 = JSON.parse(lines[1]) as LogEntry;
    expect(entry1.level).toBe("warn");
    expect(entry2.level).toBe("error");
  });

  it("does not create file when level filters all messages", () => {
    const logger = new Logger({ level: "error" }, { logFilePath: logFile, stderr: false });
    logger.debug("filtered");
    logger.info("filtered");
    logger.warn("filtered");

    expect(existsSync(logFile)).toBe(false);
  });

  it("includes extra fields in JSONL", () => {
    const logger = new Logger({ level: "debug" }, { logFilePath: logFile, stderr: false });
    logger.info("request received", { model: "claude-3", upstream: "anthropic", status: 200 });

    const content = readFileSync(logFile, "utf-8").trim();
    const entry = JSON.parse(content) as LogEntry;

    expect(entry.model).toBe("claude-3");
    expect(entry.upstream).toBe("anthropic");
    expect(entry.status).toBe(200);
  });

  describe("ChildLogger", () => {
    it("binds context to all log entries", () => {
      const logger = new Logger({ level: "debug" }, { logFilePath: logFile, stderr: false });
      const child = logger.child({ component: "proxy", reqId: "abc123" });

      child.info("handling request");
      child.error("something failed");

      const lines = readFileSync(logFile, "utf-8").trim().split("\n");
      expect(lines).toHaveLength(2);

      const entry1 = JSON.parse(lines[0]) as LogEntry;
      const entry2 = JSON.parse(lines[1]) as LogEntry;

      expect(entry1.component).toBe("proxy");
      expect(entry1.reqId).toBe("abc123");
      expect(entry2.component).toBe("proxy");
      expect(entry2.reqId).toBe("abc123");
    });

    it("merges per-call fields with bound context", () => {
      const logger = new Logger({ level: "debug" }, { logFilePath: logFile, stderr: false });
      const child = logger.child({ component: "proxy" });

      child.info("response", { status: 200, durationMs: 150 });

      const content = readFileSync(logFile, "utf-8").trim();
      const entry = JSON.parse(content) as LogEntry;

      expect(entry.component).toBe("proxy");
      expect(entry.status).toBe(200);
      expect(entry.durationMs).toBe(150);
    });

    it("per-call fields override bound context", () => {
      const logger = new Logger({ level: "debug" }, { logFilePath: logFile, stderr: false });
      const child = logger.child({ component: "proxy", upstream: "anthropic" });

      child.info("rerouted", { upstream: "zai" });

      const content = readFileSync(logFile, "utf-8").trim();
      const entry = JSON.parse(content) as LogEntry;

      expect(entry.upstream).toBe("zai");
    });
  });

  describe("setLevel", () => {
    it("updates the log level dynamically", () => {
      const logger = new Logger({ level: "error" }, { logFilePath: logFile, stderr: false });
      logger.info("should not appear");

      logger.setLevel("debug");
      logger.info("should appear");

      const content = readFileSync(logFile, "utf-8").trim();
      const entry = JSON.parse(content) as LogEntry;
      expect(entry.msg).toBe("should appear");
    });
  });
});
