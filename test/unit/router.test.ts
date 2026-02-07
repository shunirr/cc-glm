/**
 * Unit tests for router
 */

import { describe, it, expect } from "vitest";
import { selectRoute } from "../../src/proxy/router.js";
import type { Config } from "../../src/config/types.js";

const baseConfig: Config = {
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
  routing: {
    rules: [],
    default: "anthropic",
  },
};

function configWithRules(rules: Config["routing"]["rules"], defaultUpstream = "anthropic"): Config {
  return {
    ...baseConfig,
    routing: { rules, default: defaultUpstream },
  };
}

describe("selectRoute", () => {
  describe("with no routing rules (backward compatible)", () => {
    it("routes undefined model to default upstream", () => {
      const result = selectRoute(undefined, baseConfig);
      expect(result.name).toBe("anthropic");
      expect(result.url).toBe("https://api.anthropic.com");
    });

    it("routes any model to default upstream when no rules match", () => {
      const result = selectRoute("claude-sonnet-4-5-20250929", baseConfig);
      expect(result.name).toBe("anthropic");
    });
  });

  describe("pattern matching", () => {
    it("matches exact model name", () => {
      const config = configWithRules([
        { match: "glm-4", upstream: "zai" },
      ]);
      const result = selectRoute("glm-4", config);
      expect(result.name).toBe("zai");
    });

    it("matches wildcard pattern", () => {
      const config = configWithRules([
        { match: "glm-*", upstream: "zai" },
      ]);
      const result = selectRoute("glm-4-plus", config);
      expect(result.name).toBe("zai");
    });

    it("matches claude-sonnet-* pattern", () => {
      const config = configWithRules([
        { match: "claude-sonnet-*", upstream: "zai", model: "glm-4-plus" },
      ]);
      const result = selectRoute("claude-sonnet-4-5-20250929", config);
      expect(result.name).toBe("zai");
      expect(result.model).toBe("glm-4-plus");
    });

    it("matches claude-haiku-* pattern", () => {
      const config = configWithRules([
        { match: "claude-haiku-*", upstream: "zai", model: "glm-4-flash" },
      ]);
      const result = selectRoute("claude-haiku-4-5-20251001", config);
      expect(result.name).toBe("zai");
      expect(result.model).toBe("glm-4-flash");
    });

    it("does not match when pattern does not match", () => {
      const config = configWithRules([
        { match: "glm-*", upstream: "zai" },
      ]);
      const result = selectRoute("claude-sonnet-4-5-20250929", config);
      expect(result.name).toBe("anthropic");
    });

    it("does not match partial pattern without wildcard", () => {
      const config = configWithRules([
        { match: "glm-4", upstream: "zai" },
      ]);
      const result = selectRoute("glm-4-plus", config);
      expect(result.name).toBe("anthropic");
    });
  });

  describe("model rewriting", () => {
    it("returns model from rule when specified", () => {
      const config = configWithRules([
        { match: "claude-sonnet-*", upstream: "zai", model: "glm-4-plus" },
      ]);
      const result = selectRoute("claude-sonnet-4-5-20250929", config);
      expect(result.model).toBe("glm-4-plus");
    });

    it("returns undefined model when not specified in rule", () => {
      const config = configWithRules([
        { match: "glm-*", upstream: "zai" },
      ]);
      const result = selectRoute("glm-4-plus", config);
      expect(result.model).toBeUndefined();
    });

    it("returns undefined model for default fallback", () => {
      const result = selectRoute("some-model", baseConfig);
      expect(result.model).toBeUndefined();
    });
  });

  describe("rule ordering (first match wins)", () => {
    it("uses first matching rule", () => {
      const config = configWithRules([
        { match: "claude-*", upstream: "zai", model: "first-match" },
        { match: "claude-sonnet-*", upstream: "zai", model: "second-match" },
      ]);
      const result = selectRoute("claude-sonnet-4-5-20250929", config);
      expect(result.model).toBe("first-match");
    });

    it("falls through to later rules if earlier ones don't match", () => {
      const config = configWithRules([
        { match: "glm-*", upstream: "zai", model: "glm-match" },
        { match: "claude-*", upstream: "zai", model: "claude-match" },
      ]);
      const result = selectRoute("claude-sonnet-4-5-20250929", config);
      expect(result.model).toBe("claude-match");
    });
  });

  describe("default upstream", () => {
    it("uses anthropic as default when configured", () => {
      const config = configWithRules([], "anthropic");
      const result = selectRoute("unknown-model", config);
      expect(result.name).toBe("anthropic");
      expect(result.url).toBe("https://api.anthropic.com");
      expect(result.apiKey).toBe("sk-test");
    });

    it("uses zai as default when configured", () => {
      const config = configWithRules([], "zai");
      const result = selectRoute("unknown-model", config);
      expect(result.name).toBe("zai");
      expect(result.url).toBe("https://api.z.ai/api/anthropic");
      expect(result.apiKey).toBe("zai-test");
    });
  });

  describe("upstream resolution", () => {
    it("returns correct URL and apiKey for zai upstream", () => {
      const config = configWithRules([
        { match: "glm-*", upstream: "zai" },
      ]);
      const result = selectRoute("glm-4", config);
      expect(result.url).toBe("https://api.z.ai/api/anthropic");
      expect(result.apiKey).toBe("zai-test");
    });

    it("returns correct URL and apiKey for anthropic upstream", () => {
      const result = selectRoute("claude-opus-4-0-20250514", baseConfig);
      expect(result.url).toBe("https://api.anthropic.com");
      expect(result.apiKey).toBe("sk-test");
    });
  });
});
