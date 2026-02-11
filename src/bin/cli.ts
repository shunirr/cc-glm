#!/usr/bin/env node
/**
 * CLI entry point for cc-glm
 * Main entry point that replaces the claude-w bash script
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { loadConfig } from "../config/loader.js";
import { SingletonProxy } from "../lifecycle/singleton.js";
import { hasClaudeProcess } from "../lifecycle/tracker.js";
import { Logger } from "../utils/logger.js";
import { resolveClaudePath } from "../utils/claude.js";
import { tailLogs } from "./log-tail.js";

/** Main CLI function */
async function main(): Promise<void> {
  // Check for logs subcommand before loading config
  const args = process.argv.slice(2);
  if (args[0] === "logs") {
    await handleLogsCommand(args.slice(1));
    return;
  }

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
    logger.debug(`Using claude: ${claudePath}`, { component: "cli" });
  } catch (err) {
    logger.error(`Failed to locate claude: ${err}`, { component: "cli" });
    process.exit(1);
    return;
  }

  // Initialize singleton proxy manager
  const proxy = new SingletonProxy(config, logger);

  // Start proxy (singleton - will reuse if already running)
  logger.info("Starting proxy...", { component: "cli" });
  await proxy.start();
  logger.info(`Proxy ready at ${proxy.getBaseUrl()}`, { component: "cli" });

  // Set environment variable for Claude Code
  const baseUrl = proxy.getBaseUrl();
  process.env.ANTHROPIC_BASE_URL = baseUrl;

  // Forward all arguments to claude command
  logger.info(`Starting claude with args: ${args.join(" ") || "(no args)"}`, { component: "cli" });

  // Spawn claude process
  const claude = spawn(claudePath, args, {
    stdio: "inherit",
    env: { ...process.env, ANTHROPIC_BASE_URL: baseUrl },
  });

  // Wait for claude to exit
  const exitCode = await new Promise<number>((resolve) => {
    claude.on("close", (code) => {
      resolve(code ?? 0);
    });

    claude.on("error", (err) => {
      logger.error(`Failed to start claude: ${err.message}`, { component: "cli" });
      resolve(1);
    });
  });

  logger.info(`Claude exited with code ${exitCode}`, { component: "cli" });

  // Stop proxy if no other Claude processes are running
  logger.info("Checking for other Claude processes...", { component: "cli" });
  const hasClaude = await hasClaudeProcess();
  if (!hasClaude) {
    logger.info("No other Claude processes running, stopping proxy...", { component: "cli" });
    await proxy.stopIfNoClaude(hasClaudeProcess);
  } else {
    logger.info("Other Claude processes still running, keeping proxy alive", { component: "cli" });
  }

  // Exit with same code as claude
  process.exit(exitCode);
}

/** Handle the 'logs' subcommand */
async function handleLogsCommand(args: string[]): Promise<void> {
  // Parse --level and --no-follow flags
  let level: string | undefined;
  let follow = true;

  for (const arg of args) {
    if (arg.startsWith("--level=")) {
      level = arg.split("=")[1];
    } else if (arg === "--no-follow") {
      follow = false;
    }
  }

  // Load config to find log file path
  const { config } = await loadConfig();
  const logFilePath = config.logging.file ?? join(config.lifecycle.stateDir, "cc-glm.jsonl");

  await tailLogs(logFilePath, { level, follow });
}

// Run main function
main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
