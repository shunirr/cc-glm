/**
 * Claude command path resolution utilities
 */

import { existsSync } from "node:fs";
import { execCommand } from "./process.js";

/**
 * Resolve the path to the Claude executable
 * @param configPath - Path from config (empty string = auto-detect)
 * @returns Resolved absolute path to the Claude executable
 * @throws Error if Claude cannot be found
 */
export async function resolveClaudePath(configPath: string): Promise<string> {
  // Config path specified - validate it exists
  if (configPath) {
    if (!existsSync(configPath)) {
      throw new Error(`Claude executable not found at: ${configPath}`);
    }
    return configPath;
  }

  // Auto-detect using which (Unix/macOS) or where (Windows)
  const detector = process.platform === "win32" ? "where" : "which";
  try {
    return await execCommand(detector, ["claude"]);
  } catch (err) {
    const error = err as Error & { code?: string };
    if (error.code === "ENOENT") {
      throw new Error(
        `Claude command not found. Install Claude Code CLI or set 'claude.path' in config.yml`
      );
    }
    throw err;
  }
}
