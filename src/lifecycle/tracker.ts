/**
 * Claude process tracking using pgrep
 */

import { execCommand } from "../utils/process.js";

/**
 * Check if any Claude process is running for the current user
 * Uses pgrep to find processes named "claude"
 */
export async function hasClaudeProcess(): Promise<boolean> {
  try {
    const uid = process.getuid?.() ?? process.env.UID ?? "";
    await execCommand("pgrep", [`-u`, uid.toString(), `-x`, `claude`]);
    return true;
  } catch {
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
