/**
 * Process-related utilities
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile, unlink } from "node:fs/promises";

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
        reject(new Error(`${command} failed with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

/** Check if a PID is alive */
export function pidIsAlive(pid: number): boolean {
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
  } catch {
    return false;
  }
}

/** Ensure state directory exists */
export async function ensureStateDir(stateDir: string): Promise<void> {
  if (!existsSync(stateDir)) {
    await mkdir(stateDir, { recursive: true });
  }
}

/** Read PID from file */
export function readPidFile(pidFile: string): number | null {
  try {
    if (!existsSync(pidFile)) {
      return null;
    }
    const content = readFileSync(pidFile, "utf-8");
    const pid = parseInt(content.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/** Write PID to file */
export async function writePidFile(pidFile: string, pid: number): Promise<void> {
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
