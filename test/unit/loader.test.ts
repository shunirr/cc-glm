/**
 * Unit tests for configuration loader
 * Tests signatureStore config merging and validation
 */

import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/config/loader.js";

describe("loadConfig", () => {
  describe("signatureStore defaults", () => {
    it("uses default signatureStore config when no config file exists", async () => {
      const config = await loadConfig("/nonexistent/path/config.yml");

      expect(config.signatureStore).toBeDefined();
      expect(config.signatureStore!.maxSize).toBe(1000);
    });
  });
});
