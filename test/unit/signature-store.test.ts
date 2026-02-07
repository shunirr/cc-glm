/**
 * Unit tests for SignatureStore
 */

import { describe, it, expect } from "vitest";
import { SignatureStore } from "../../src/proxy/signature-store.js";

describe("SignatureStore", () => {
  describe("basic operations", () => {
    it("adds and checks signatures", () => {
      const store = new SignatureStore(10);

      store.add("sig-123");
      expect(store.has("sig-123")).toBe(true);
      expect(store.has("sig-456")).toBe(false);
    });

    it("returns false for empty signature", () => {
      const store = new SignatureStore(10);

      expect(store.has("")).toBe(false);
      store.add("");
      expect(store.has("")).toBe(false);
    });

    it("returns false for undefined signature", () => {
      const store = new SignatureStore(10);

      expect(store.has(undefined as unknown as string)).toBe(false);
    });

    it("ignores non-string signatures on add", () => {
      const store = new SignatureStore(10);

      store.add(123 as unknown as string);
      store.add(null as unknown as string);
      store.add(undefined as unknown as string);
      store.add({} as unknown as string);

      expect(store.size).toBe(0);
    });

    it("returns false for non-string signatures on has", () => {
      const store = new SignatureStore(10);

      expect(store.has(123 as unknown as string)).toBe(false);
      expect(store.has(null as unknown as string)).toBe(false);
      expect(store.has({} as unknown as string)).toBe(false);
    });

    it("returns the correct size", () => {
      const store = new SignatureStore(10);

      expect(store.size).toBe(0);

      store.add("sig-1");
      expect(store.size).toBe(1);

      store.add("sig-2");
      expect(store.size).toBe(2);

      store.add("sig-1"); // Duplicate
      expect(store.size).toBe(2);
    });

    it("clears all signatures", () => {
      const store = new SignatureStore(10);

      store.add("sig-1");
      store.add("sig-2");
      store.add("sig-3");
      expect(store.size).toBe(3);

      store.clear();
      expect(store.size).toBe(0);
      expect(store.has("sig-1")).toBe(false);
    });

    it("gets all signatures", () => {
      const store = new SignatureStore(10);

      store.add("sig-1");
      store.add("sig-2");
      store.add("sig-3");

      const signatures = store.getAllSignatures();
      expect(signatures).toHaveLength(3);
      expect(signatures).toContain("sig-1");
      expect(signatures).toContain("sig-2");
      expect(signatures).toContain("sig-3");
    });
  });

  describe("LRU eviction", () => {
    it("evicts least recently used entry when at capacity", () => {
      const store = new SignatureStore(3);

      store.add("sig-1");
      store.add("sig-2");
      store.add("sig-3");
      expect(store.size).toBe(3);

      // Adding a 4th signature should evict sig-1 (least recently used)
      store.add("sig-4");
      expect(store.size).toBe(3);
      expect(store.has("sig-1")).toBe(false);
      expect(store.has("sig-2")).toBe(true);
      expect(store.has("sig-3")).toBe(true);
      expect(store.has("sig-4")).toBe(true);
    });

    it("updates access order on has() check", () => {
      const store = new SignatureStore(3);

      store.add("sig-1");
      store.add("sig-2");
      store.add("sig-3");

      // Check sig-1 to make it recently used
      store.has("sig-1");

      // Add sig-4, should evict sig-2 (now least recently used)
      store.add("sig-4");
      expect(store.has("sig-1")).toBe(true);
      expect(store.has("sig-2")).toBe(false);
      expect(store.has("sig-3")).toBe(true);
      expect(store.has("sig-4")).toBe(true);
    });

    it("updates access order on add() of existing signature", () => {
      const store = new SignatureStore(3);

      store.add("sig-1");
      store.add("sig-2");
      store.add("sig-3");

      // Re-add sig-1 to make it recently used
      store.add("sig-1");

      // Add sig-4, should evict sig-2 (now least recently used)
      store.add("sig-4");
      expect(store.has("sig-1")).toBe(true);
      expect(store.has("sig-2")).toBe(false);
      expect(store.has("sig-3")).toBe(true);
      expect(store.has("sig-4")).toBe(true);
    });

    it("handles multiple evictions correctly", () => {
      const store = new SignatureStore(2);

      store.add("sig-1");
      store.add("sig-2");
      store.add("sig-3");
      store.add("sig-4");

      expect(store.size).toBe(2);
      expect(store.has("sig-3")).toBe(true);
      expect(store.has("sig-4")).toBe(true);
      expect(store.has("sig-1")).toBe(false);
      expect(store.has("sig-2")).toBe(false);
    });
  });

  describe("constructor validation", () => {
    it("uses default max size of 1000 when not specified", () => {
      const store = new SignatureStore();

      // Add 1000 signatures
      for (let i = 0; i < 1000; i++) {
        store.add(`sig-${i}`);
      }

      expect(store.size).toBe(1000);

      // Adding one more should not exceed 1000
      store.add("sig-1000");
      expect(store.size).toBe(1000);
      expect(store.has("sig-0")).toBe(false);
    });

    it("falls back to default for maxSize of 0", () => {
      const store = new SignatureStore(0);

      for (let i = 0; i < 1001; i++) {
        store.add(`sig-${i}`);
      }

      // Should use default (1000), not 0
      expect(store.size).toBe(1000);
    });

    it("falls back to default for negative maxSize", () => {
      const store = new SignatureStore(-5);

      store.add("sig-1");
      store.add("sig-2");

      // Should use default, so both should be stored
      expect(store.size).toBe(2);
      expect(store.has("sig-1")).toBe(true);
    });

    it("falls back to default for non-integer maxSize", () => {
      const store = new SignatureStore(3.5);

      store.add("sig-1");
      store.add("sig-2");

      // Should use default, so both should be stored
      expect(store.size).toBe(2);
    });

    it("falls back to default for NaN maxSize", () => {
      const store = new SignatureStore(NaN);

      store.add("sig-1");
      expect(store.size).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("handles adding the same signature multiple times", () => {
      const store = new SignatureStore(10);

      store.add("sig-1");
      store.add("sig-1");
      store.add("sig-1");

      expect(store.size).toBe(1);
      expect(store.has("sig-1")).toBe(true);
    });

    it("handles special characters in signatures", () => {
      const store = new SignatureStore(10);

      const specialSig = "sig-abc123+/= XYZ";
      store.add(specialSig);

      expect(store.has(specialSig)).toBe(true);
    });

    it("handles very long signatures", () => {
      const store = new SignatureStore(10);

      const longSig = "x".repeat(10000);
      store.add(longSig);

      expect(store.has(longSig)).toBe(true);
    });

    it("handles checking non-existent signatures", () => {
      const store = new SignatureStore(10);

      store.add("sig-1");

      expect(store.has("sig-2")).toBe(false);
      expect(store.has("")).toBe(false);
    });
  });
});
