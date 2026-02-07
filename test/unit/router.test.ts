/**
 * Unit tests for router
 */

import { describe, it, expect } from "vitest";
import { selectRoute } from "../../src/proxy/router.js";
import type { Config } from "../../src/config/types.js";

const mockConfig: Config = {
  proxy: { port: 8787, host: "127.0.0.1" },
  upstream: {
    anthropic: { url: "https://api.anthropic.com", apiKey: "sk-test" },
    zai: { url: "https://api.z.ai/api/anthropic", apiKey: "zai-test" },
  },
  lifecycle: {
    stopGraceSeconds: 8,
    startWaitSeconds: 8,
    stateDir: "/tmp/test",
  },
  logging: { level: "info" },
};

describe("selectRoute", () => {
  it("routes glm-* models to z.ai", () => {
    const result = selectRoute("glm-4", mockConfig);
    expect(result.name).toBe("zai");
    expect(result.url).toBe("https://api.z.ai/api/anthropic");
    expect(result.apiKey).toBe("zai-test");
  });

  it("routes Claude models to Anthropic", () => {
    const result = selectRoute("claude-sonnet-4-5-20250929", mockConfig);
    expect(result.name).toBe("anthropic");
    expect(result.url).toBe("https://api.anthropic.com");
    expect(result.apiKey).toBe("sk-test");
  });

  it("routes undefined model to Anthropic", () => {
    const result = selectRoute(undefined, mockConfig);
    expect(result.name).toBe("anthropic");
  });
});
