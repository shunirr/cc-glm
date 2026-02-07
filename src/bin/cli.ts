#!/usr/bin/env node
/**
 * CLI entry point for cc-glm
 * Main entry point that replaces the claude-w bash script
 */

import { spawn } from "node:child_process";
import { loadConfig } from "../config/loader.js";
import { SingletonProxy } from "../lifecycle/singleton.js";
import { hasClaudeProcess } from "../lifecycle/tracker.js";
import { Logger } from "../utils/logger.js";

/** Main CLI function */
async function main(): Promise<void> {
  // Load configuration
  const config = await loadConfig();
  const logger = new Logger(config.logging);

  // Initialize singleton proxy manager
  const proxy = new SingletonProxy(config);

  // Start proxy (singleton - will reuse if already running)
  logger.info("Starting proxy...");
  await proxy.start();
  logger.info(`Proxy ready at ${proxy.getBaseUrl()}`);

  // Set environment variable for Claude Code
  const baseUrl = proxy.getBaseUrl();
  process.env.ANTHROPIC_BASE_URL = baseUrl;

  // Forward all arguments to claude command
  const args = process.argv.slice(2);
  logger.info(`Starting claude with args: ${args.join(" ") || "(no args)"}`);

  // Spawn claude process
  const claude = spawn("claude", args, {
    stdio: "inherit",
    env: { ...process.env, ANTHROPIC_BASE_URL: baseUrl },
  });

  // Wait for claude to exit
  const exitCode = await new Promise<number>((resolve) => {
    claude.on("close", (code) => {
      resolve(code ?? 0);
    });

    claude.on("error", (err) => {
      logger.error(`Failed to start claude: ${err.message}`);
      resolve(1);
    });
  });

  logger.info(`Claude exited with code ${exitCode}`);

  // Stop proxy if no other Claude processes are running
  logger.info("Checking for other Claude processes...");
  const hasClaude = await hasClaudeProcess();
  if (!hasClaude) {
    logger.info("No other Claude processes running, stopping proxy...");
    await proxy.stopIfNoClaude(hasClaudeProcess);
  } else {
    logger.info("Other Claude processes still running, keeping proxy alive");
  }

  // Exit with same code as claude
  process.exit(exitCode);
}

// Run main function
main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
