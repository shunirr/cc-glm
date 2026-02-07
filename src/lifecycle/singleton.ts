/**
 * Singleton proxy management
 * Handles proxy lifecycle: start, stop, and status checking
 */

import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
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
    // Already listening?
    if (await isPortListening(this.config.proxy.port)) {
      return;
    }

    // Ensure state directory exists before acquiring lock (lock dir is inside stateDir)
    await ensureStateDir(this.config.lifecycle.stateDir);

    // Try to acquire lock (mkdir is atomic)
    const lockAcquired = await this.acquireLock();
    if (!lockAcquired) {
      // Another process is starting the proxy, wait for it
      await this.waitForReady();
      return;
    }

    try {
      // Double-check after acquiring lock
      if (await isPortListening(this.config.proxy.port)) {
        return;
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
   */
  async stop(): Promise<void> {
    const pid = readPidFile(this.pidFile);

    if (pid && pidIsAlive(pid) && (await isPortListening(this.config.proxy.port))) {
      // Graceful shutdown
      process.kill(pid, "SIGTERM");

      // Wait for process to exit
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if (!pidIsAlive(pid)) {
          break;
        }
        await sleep(100);
      }

      // Force kill if still alive
      if (pidIsAlive(pid)) {
        process.kill(pid, "SIGKILL");
      }
    } else {
      // Stale PID file
      await removePidFile(this.pidFile);
    }
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

    proc.unref();
    await writePidFile(this.pidFile, proc.pid ?? 0);
  }
}
