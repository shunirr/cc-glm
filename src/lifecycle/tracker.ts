/**
 * Claude process tracking using pgrep
 */

import { execCommand } from "../utils/process.js";

/**
 * Check if any Claude process is running for the current user
 * Uses pgrep to find processes named "claude"
 *
 * NOTE: This matches any process containing "claude" in name, including:
 * - cc-glm CLI processes
 * - Claude Desktop App
 * - Other Claude-related processes
 */
export async function hasClaudeProcess(logger?: { debug: (msg: string) => void }): Promise<boolean> {
  try {
    const uid = process.getuid?.() ?? process.env.UID ?? "";
    const output = await execCommand("pgrep", [`-u`, uid.toString(), `-x`, `claude`, `-l`]); // -l lists names
    logger?.debug(`Claude processes detected: ${output.trim() || "(none)"}`);
    return true;
  } catch (err) {
    const error = err as Error;
    // pgrep returns exit code 1 when no processes found
    if ("code" in error && error.code === 1) {
      logger?.debug("No Claude processes found (pgrep exit code 1)");
    } else {
      logger?.debug(`pgrep error: ${error.message}`);
    }
    return false;
  }
}

/**
 * Get list of Claude process IDs
 */
export async function getClaudePids(): Promise<number[]> {
  try {
    const uid = process.getuid?.() ?? process.env.UID ?? "";
    const output = await execCommand("pgrep", [`-u`, uid.toString(), `-x`, `claude`]);
    return output.split("\n").map((line) => parseInt(line.trim(), 10)).filter((pid) => !isNaN(pid));
  } catch {
    return [];
  }
}
