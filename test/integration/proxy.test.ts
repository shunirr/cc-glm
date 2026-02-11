/**
 * Integration tests for proxy server
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createProxyServer } from "../../src/proxy/server.js";
import { Logger } from "../../src/utils/logger.js";
import type { Config } from "../../src/config/types.js";

const mockConfig: Config = {
  proxy: { port: 18787, host: "127.0.0.1" },
  upstream: {
    anthropic: { url: "https://api.anthropic.com" },
    zai: { url: "https://api.z.ai/api/anthropic", apiKey: "zai-test" },
  },
  lifecycle: {
    stopGraceSeconds: 8,
    startWaitSeconds: 8,
    stateDir: "/tmp/test-proxy",
  },
  logging: { level: "error" },
  routing: { rules: [], default: "anthropic" },
};

describe("Proxy Server Integration", () => {
  let server: ReturnType<typeof createProxyServer>;
  const logger = new Logger(mockConfig.logging, { stderr: false });

  beforeAll(() => {
    return new Promise<void>((resolve) => {
      server = createProxyServer(mockConfig, logger);
      server.on("listening", () => resolve());
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  it("should create a server instance", () => {
    expect(server).toBeDefined();
    expect(server.listening).toBe(true);
  });
});
