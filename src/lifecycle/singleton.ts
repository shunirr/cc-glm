/**
 * Singleton proxy management
 * Handles proxy lifecycle: start, stop, and status checking
 */

import { spawn } from "node:child_process";
import { existsSync, openSync, closeSync } from "node:fs";
import { mkdir, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../config/types.js";
import {
  isPortListening,
  pidIsAlive,
  ensureStateDir,
  readPidFile,
  writePidFile,
  removePidFile,
  sleep,
  execCommand,
} from "../utils/process.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Singleton proxy manager */
export class SingletonProxy {
  private config: Config;
  private pidFile: string;
  private lockDir: string;
  private logFile: string;

  constructor(config: Config) {
    this.config = config;
    const stateDir = config.lifecycle.stateDir;
    this.pidFile = join(stateDir, "proxy.pid");
    this.lockDir = join(stateDir, "lock");
    this.logFile = join(stateDir, "proxy.log");
  }

  /**
   * Start proxy if not already running
   * Uses lock directory for atomic singleton behavior
   */
  async start(): Promise<void> {
    // Ensure state directory exists before acquiring lock (lock dir is inside stateDir)
    await ensureStateDir(this.config.lifecycle.stateDir);

    // Check for stale lock and recover if necessary
    await this.recoverStaleLock();

    // Check if port is already listening
    if (await isPortListening(this.config.proxy.port)) {
      // Verify the existing process is actually our proxy
      const pid = readPidFile(this.pidFile);
      if (pid && pid > 0 && pidIsAlive(pid) && (await this.verifyPidOwnsPort(pid))) {
        // Port is listening, PID is alive, and PID owns the port - it's our proxy
        console.log(`Proxy already running on port ${this.config.proxy.port} (PID ${pid})`);
        return;
      } else {
        // Port is listening but it's not our proxy
        throw new Error(
          `Port ${this.config.proxy.port} is already in use by another process. ` +
          `Please stop the other process or configure a different port.`
        );
      }
    }

    // Try to acquire lock (mkdir is atomic)
    const lockAcquired = await this.acquireLock();
    if (!lockAcquired) {
      // Another process is starting the proxy, wait for it
      await this.waitForReady();
      return;
    }

    try {
      // Double-check after acquiring lock - verify any existing process is actually our proxy
      if (await isPortListening(this.config.proxy.port)) {
        const pid = readPidFile(this.pidFile);
        if (pid && pid > 0 && pidIsAlive(pid) && (await this.verifyPidOwnsPort(pid))) {
          // It's our proxy, already running
          return;
        } else {
          // Port taken by another process
          throw new Error(
            `Port ${this.config.proxy.port} is already in use by another process.`
          );
        }
      }

      // Start proxy process
      await this.startProxyProcess();

      // Wait for proxy to be ready
      await this.waitForReady();
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Stop proxy if no Claude processes are running
   */
  async stopIfNoClaude(hasClaude: () => Promise<boolean>): Promise<void> {
    const { stopGraceSeconds } = this.config.lifecycle;

    // Wait for grace period to ensure no new Claude processes start
    for (let i = 0; i < stopGraceSeconds; i++) {
      if (await hasClaude()) {
        return; // Claude still running, don't stop
      }
      await sleep(1000);
    }

    // No Claude processes for grace period, stop proxy
    await this.stop();
  }

  /**
   * Stop the proxy process
   * Verifies PID owns the target port before killing to avoid PID reuse issues
   */
  async stop(): Promise<void> {
    const pid = readPidFile(this.pidFile);

    if (pid && pid > 0) {
      // Verify the PID is actually listening on the target port
      const isOurProcess = await this.verifyPidOwnsPort(pid);

      if (isOurProcess) {
        // Graceful shutdown with exception handling
        try {
          process.kill(pid, "SIGTERM");
        } catch (err) {
          const error = err as Error;
          // ESRCH = no such process, EPERM = no permission
          if ("code" in error && (error.code === "ESRCH" || error.code === "EPERM")) {
            console.warn(`Failed to send SIGTERM to PID ${pid}: ${error.message}`);
          } else {
            throw error;
          }
        }

        // Wait for process to exit
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          if (!pidIsAlive(pid)) {
            break;
          }
          await sleep(100);
        }

        // Force kill if still alive AND still owns the port (verify to avoid PID reuse)
        if (pidIsAlive(pid) && (await this.verifyPidOwnsPort(pid))) {
          try {
            process.kill(pid, "SIGKILL");
          } catch (err) {
            const error = err as Error;
            if ("code" in error && (error.code === "ESRCH" || error.code === "EPERM")) {
              console.warn(`Failed to send SIGKILL to PID ${pid}: ${error.message}`);
            } else {
              throw error;
            }
          }
        }
      } else {
        // PID exists but doesn't own the port - stale PID file
        console.warn(`PID ${pid} does not own port ${this.config.proxy.port}, treating as stale`);
      }
    }

    // Clean up PID file regardless
    await removePidFile(this.pidFile);
  }

  /**
   * Get the proxy base URL
   */
  getBaseUrl(): string {
    const { host, port } = this.config.proxy;
    return `http://${host}:${port}`;
  }

  /**
   * Try to acquire lock directory
   */
  private async acquireLock(): Promise<boolean> {
    try {
      await mkdir(this.lockDir, { recursive: false });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Release lock directory
   */
  private async releaseLock(): Promise<void> {
    try {
      await rmdir(this.lockDir);
    } catch {
      // Ignore
    }
  }

  /**
   * Recover from a stale lock directory
   * Handles cases where:
   * - Lock exists but port is not listening and PID is dead
   * - Lock exists but PID is alive but doesn't own the port (PID reuse)
   */
  private async recoverStaleLock(): Promise<void> {
    // If lock doesn't exist, nothing to do
    if (!existsSync(this.lockDir)) {
      return;
    }

    // Check if port is listening
    const portListening = await isPortListening(this.config.proxy.port);

    // Check if PID is alive
    const pid = readPidFile(this.pidFile);
    const pidAlive = pid !== null && pid > 0 && pidIsAlive(pid);

    // Determine if lock is stale
    let lockIsStale = false;

    if (!portListening && !pidAlive) {
      // Neither port listening nor PID alive - definitely stale
      lockIsStale = true;
    } else if (pidAlive && !portListening) {
      // PID is alive but port not listening - PID might be for a different process now
      // Verify if this PID actually owns our port
      const ownsPort = await this.verifyPidOwnsPort(pid!);
      if (!ownsPort) {
        // PID doesn't own the port - stale lock (PID reused)
        lockIsStale = true;
      }
    }

    if (lockIsStale) {
      console.warn("Detected stale lock directory, recovering...");
      try {
        await rmdir(this.lockDir);
        await removePidFile(this.pidFile);
        console.warn("Stale lock recovered");
      } catch (err) {
        const error = err as Error;
        console.error(`Failed to recover stale lock: ${error.message}`);
      }
    }
  }

  /**
   * Verify that a PID is actually listening on the target port
   * This prevents killing a reused PID that doesn't belong to our proxy
   */
  private async verifyPidOwnsPort(pid: number): Promise<boolean> {
    // First check if port is listening at all
    if (!(await isPortListening(this.config.proxy.port))) {
      return false;
    }

    // Then check if the PID is alive
    if (!pidIsAlive(pid)) {
      return false;
    }

    // Use lsof to verify the specific PID owns the port
    try {
      const output = await execCommand("lsof", [
        "-nP",
        `-iTCP:${this.config.proxy.port}`,
        "-sTCP:LISTEN",
        "-p",
        pid.toString(),
      ]);
      // If lsof succeeds with this PID, it owns the port
      return output.includes(pid.toString());
    } catch {
      // lsof failed - either PID doesn't own port or command failed
      return false;
    }
  }

  /**
   * Wait for proxy to be ready (port listening)
   */
  private async waitForReady(): Promise<void> {
    const { startWaitSeconds } = this.config.lifecycle;
    const deadline = Date.now() + startWaitSeconds * 1000;

    while (Date.now() < deadline) {
      if (await isPortListening(this.config.proxy.port)) {
        return;
      }
      await sleep(100);
    }

    throw new Error(
      `Proxy did not become ready at ${this.getBaseUrl()} (log: ${this.logFile})`
    );
  }

  /**
   * Start the proxy server as a detached process
   */
  private async startProxyProcess(): Promise<void> {
    // Find the server entry point (CLI is in dist/bin/, server is in dist/proxy/)
    const serverPath = join(__dirname, "..", "proxy", "server.js");

    if (!existsSync(serverPath)) {
      throw new Error(`Proxy entry not found: ${serverPath}`);
    }

    // Spawn detached process with log file descriptor
    const logFd = openSync(this.logFile, "a");
    const proc = spawn(process.execPath, [serverPath], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env }, // Inherit all environment variables
    });

    // Validate PID before unrefing and writing to file
    const pid = proc.pid;
    if (!pid || pid < 1) {
      closeSync(logFd);
      throw new Error("Failed to get valid PID from spawned process");
    }

    proc.unref();
    await writePidFile(this.pidFile, pid);

    // Close log FD in parent process (child has its own copy via dup2)
    closeSync(logFd);
  }
}
