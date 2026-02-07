/**
 * Signature Store for tracking Anthropic thinking block signatures
 * Uses Map insertion order for O(1) LRU eviction
 */

/** Default maximum number of signatures to store */
const DEFAULT_MAX_SIZE = 1000;

/**
 * Signature Store using Map-based LRU cache
 * Tracks signatures from Anthropic thinking blocks to distinguish them from z.ai blocks
 *
 * Uses Map's insertion order guarantee: iterating a Map yields entries in insertion order.
 * By deleting and re-setting an entry on access, the entry moves to the end (most recent).
 * The first entry in iteration order is always the least recently used.
 */
export class SignatureStore {
  private cache: Map<string, true>;
  private maxSize: number;

  /**
   * Create a new SignatureStore
   * @param maxSize - Maximum number of signatures to store (default: 1000, min: 1)
   */
  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      this.maxSize = DEFAULT_MAX_SIZE;
    } else {
      this.maxSize = maxSize;
    }
    this.cache = new Map();
  }

  /**
   * Add a signature to the store
   * If the store is full, removes the least recently used entry
   * @param signature - The signature string to store
   */
  add(signature: string): void {
    if (typeof signature !== "string" || signature === "") {
      return;
    }

    // Delete first to update insertion order (move to end)
    if (this.cache.has(signature)) {
      this.cache.delete(signature);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used entry (first in Map iteration order)
      const lruKey = this.cache.keys().next().value;
      if (lruKey !== undefined) {
        this.cache.delete(lruKey);
      }
    }

    this.cache.set(signature, true);
  }

  /**
   * Check if a signature exists in the store
   * Marks the signature as recently used if found
   * @param signature - The signature string to check
   * @returns true if the signature is in the store
   */
  has(signature: string): boolean {
    if (typeof signature !== "string" || signature === "") {
      return false;
    }

    if (this.cache.has(signature)) {
      // Move to end of Map (most recently used)
      this.cache.delete(signature);
      this.cache.set(signature, true);
      return true;
    }
    return false;
  }

  /**
   * Get the current number of signatures in the store
   * @returns The number of stored signatures
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Clear all signatures from the store
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get all stored signatures (for testing/debugging)
   * @returns Array of all signatures in the store
   */
  getAllSignatures(): string[] {
    return Array.from(this.cache.keys());
  }
}
