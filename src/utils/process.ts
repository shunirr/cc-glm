/**
 * Process-related utilities
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile, unlink } from "node:fs/promises";

/** Minimum valid PID (PIDs are always > 0) */
const MIN_VALID_PID = 1;

/** Execute a command and return its output */
export async function execCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        const error = new Error(`${command} failed with code ${code}: ${stderr}`) as Error & { code?: number | string | null; command?: string };
        error.code = code;
        error.command = command;
        reject(error);
      }
    });

    proc.on("error", (err) => {
      // ENOENT = command not found
      const error = err as Error & { code?: string };
      if (error.code === "ENOENT") {
        const enhancedError = new Error(`Command not found: ${command}`) as Error & { code?: string; command?: string };
        enhancedError.code = "ENOENT";
        enhancedError.command = command;
        reject(enhancedError);
      } else {
        reject(err);
      }
    });
  });
}

/** Check if a PID is alive */
export function pidIsAlive(pid: number): boolean {
  // Guard against pid=0 which would send signal to process group
  if (!Number.isFinite(pid) || pid < MIN_VALID_PID) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Check if a port is listening using lsof */
export async function isPortListening(port: number): Promise<boolean> {
  try {
    await execCommand("lsof", [`-nP`, `-iTCP:${port}`, `-sTCP:LISTEN`]);
    return true;
  } catch (err) {
    const error = err as Error & { code?: string; command?: string };
    // If lsof command is not found, throw a clear error
    if (error.code === "ENOENT" && error.command === "lsof") {
      throw new Error(
        `lsof command is required but not found. Please install lsof or ensure it's in your PATH.`
      );
    }
    // Other errors (port not listening, etc.) return false
    return false;
  }
}

/** Ensure state directory exists */
export async function ensureStateDir(stateDir: string): Promise<void> {
  if (!existsSync(stateDir)) {
    await mkdir(stateDir, { recursive: true });
  }
}

/** Read PID from file, returns null if invalid or missing */
export function readPidFile(pidFile: string): number | null {
  try {
    if (!existsSync(pidFile)) {
      return null;
    }
    const content = readFileSync(pidFile, "utf-8");
    const pid = parseInt(content.trim(), 10);
    // Validate PID is in valid range
    if (isNaN(pid) || pid < MIN_VALID_PID) {
      return null;
    }
    return pid;
  } catch {
    return null;
  }
}

/** Write PID to file, throws if pid is invalid */
export async function writePidFile(pidFile: string, pid: number): Promise<void> {
  // Validate PID before writing
  if (!Number.isFinite(pid) || pid < MIN_VALID_PID) {
    throw new Error(`Invalid PID ${pid}: cannot write to PID file`);
  }
  await writeFile(pidFile, pid.toString(), "utf-8");
}

/** Remove PID file */
export async function removePidFile(pidFile: string): Promise<void> {
  try {
    await unlink(pidFile);
  } catch {
    // Ignore if file doesn't exist
  }
}

/** Sleep for specified milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
