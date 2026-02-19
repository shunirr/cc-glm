#!/usr/bin/env node
/**
 * CLI entry point for cc-glm-agent
 * Pass-through mode: forwards ALL arguments directly to Claude Code
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { loadConfig } from "../config/loader.js";
import { SingletonProxy } from "../lifecycle/singleton.js";
import { hasClaudeProcess } from "../lifecycle/tracker.js";
import { Logger } from "../utils/logger.js";
import { resolveClaudePath } from "../utils/claude.js";

/** Main CLI function - complete pass-through mode */
async function main(): Promise<void> {
  // All args go directly to Claude
  const claudeArgs = process.argv.slice(2);

  // Load configuration
  const { config, warnings } = await loadConfig();

  // Determine log file path (default to stateDir/cc-glm.jsonl)
  const logFilePath = config.logging.file ?? join(config.lifecycle.stateDir, "cc-glm.jsonl");
  const logger = new Logger(config.logging, { logFilePath });

  // Log config warnings
  for (const warning of warnings) {
    logger.warn(warning, { component: "config" });
  }

  // Resolve claude command path
  let claudePath: string;
  try {
    claudePath = await resolveClaudePath(config.claude.path);
    logger.debug(`Using claude: ${claudePath}`, { component: "cli-agent" });
  } catch (err) {
    logger.error(`Failed to locate claude: ${err}`, { component: "cli-agent" });
    process.exit(1);
    return;
  }

  // Initialize singleton proxy manager
  const proxy = new SingletonProxy(config, logger);

  // Start proxy (singleton - will reuse if already running)
  logger.info("Starting proxy...", { component: "cli-agent" });
  await proxy.start();
  logger.info(`Proxy ready at ${proxy.getBaseUrl()}`, { component: "cli-agent" });

  // Set environment variable for Claude Code
  const baseUrl = proxy.getBaseUrl();
  process.env.ANTHROPIC_BASE_URL = baseUrl;

  // Forward all claude arguments
  logger.info(`Starting claude with args: ${claudeArgs.join(" ") || "(no args)"}`, { component: "cli-agent" });

  // Spawn claude process
  const claude = spawn(claudePath, claudeArgs, {
    stdio: "inherit",
    env: { ...process.env, ANTHROPIC_BASE_URL: baseUrl },
  });

  // Wait for claude to exit
  const exitCode = await new Promise<number>((resolve) => {
    claude.on("close", (code) => {
      resolve(code ?? 0);
    });

    claude.on("error", (err) => {
      logger.error(`Failed to start claude: ${err.message}`, { component: "cli-agent" });
      resolve(1);
    });
  });

  logger.info(`Claude exited with code ${exitCode}`, { component: "cli-agent" });

  // Stop proxy if no other Claude processes are running
  logger.info("Checking for other Claude processes...", { component: "cli-agent" });
  const hasClaude = await hasClaudeProcess();
  if (!hasClaude) {
    logger.info("No other Claude processes running, stopping proxy...", { component: "cli-agent" });
    await proxy.stopIfNoClaude();
  } else {
    logger.info("Other Claude processes still running, keeping proxy alive", { component: "cli-agent" });
  }

  // Exit with same code as claude
  process.exit(exitCode);
}

// Run main function
main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
