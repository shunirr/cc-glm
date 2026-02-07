/**
 * Signature Store for tracking Anthropic thinking block signatures
 * Uses LRU (Least Recently Used) cache with a maximum size
 */

/** Default maximum number of signatures to store */
const DEFAULT_MAX_SIZE = 1000;

/**
 * LRU Cache entry containing signature and timestamp
 */
interface CacheEntry {
  signature: string;
  timestamp: number;
}

/**
 * Signature Store using LRU cache
 * Tracks signatures from Anthropic thinking blocks to distinguish them from z.ai blocks
 */
export class SignatureStore {
  private cache: Map<string, CacheEntry>;
  private maxSize: number;
  private accessOrder: string[];

  /**
   * Create a new SignatureStore
   * @param maxSize - Maximum number of signatures to store (default: 1000)
   */
  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
    this.cache = new Map();
    this.accessOrder = [];
  }

  /**
   * Add a signature to the store
   * If the store is full, removes the least recently used entry
   * @param signature - The signature string to store
   */
  add(signature: string): void {
    if (!signature) {
      return;
    }

    // Update existing entry or create new one
    if (this.cache.has(signature)) {
      // Update timestamp and move to end of access order
      const entry = this.cache.get(signature)!;
      entry.timestamp = Date.now();
      this.moveToEnd(signature);
    } else {
      // Add new entry
      if (this.cache.size >= this.maxSize) {
        // Remove least recently used entry (first in accessOrder)
        const lruSignature = this.accessOrder.shift();
        if (lruSignature) {
          this.cache.delete(lruSignature);
        }
      }

      this.cache.set(signature, {
        signature,
        timestamp: Date.now(),
      });
      this.accessOrder.push(signature);
    }
  }

  /**
   * Check if a signature exists in the store
   * Marks the signature as recently used if found
   * @param signature - The signature string to check
   * @returns true if the signature is in the store
   */
  has(signature: string): boolean {
    if (!signature) {
      return false;
    }

    const exists = this.cache.has(signature);
    if (exists) {
      // Update access order (mark as recently used)
      this.moveToEnd(signature);
    }
    return exists;
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
    this.accessOrder = [];
  }

  /**
   * Move a signature to the end of the access order (most recently used)
   * @param signature - The signature to move
   */
  private moveToEnd(signature: string): void {
    const index = this.accessOrder.indexOf(signature);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
      this.accessOrder.push(signature);
    }
  }

  /**
   * Get all stored signatures (for testing/debugging)
   * @returns Array of all signatures in the store
   */
  getAllSignatures(): string[] {
    return Array.from(this.cache.keys());
  }
}
