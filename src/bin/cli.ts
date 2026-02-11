#!/usr/bin/env node
/**
 * CLI entry point for cc-glm
 * Main entry point that replaces the claude-w bash script
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { loadConfig } from "../config/loader.js";
import { SingletonProxy } from "../lifecycle/singleton.js";
import { hasClaudeProcess } from "../lifecycle/tracker.js";
import { Logger } from "../utils/logger.js";
import { resolveClaudePath } from "../utils/claude.js";
import { tailLogs } from "./log-tail.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

const HELP_TEXT = `cc-glm - Claude Code proxy for Anthropic API / z.ai GLM routing

Usage:
  cc-glm [options]
  cc-glm [options] -- [claude-args...]
  cc-glm logs [--level=LEVEL] [--no-follow]

Options:
  -h, --help       Show this help message
  -v, --version    Show version

Claude Arguments:
  Use -- to pass arguments to the claude command.
  Example: cc-glm -- --help
`;

function printHelp(): void {
  process.stdout.write(HELP_TEXT);
}

function printVersion(): void {
  process.stdout.write(`${version}\n`);
}

/** Main CLI function */
async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  // Check for logs subcommand before loading config
  if (rawArgs[0] === "logs") {
    await handleLogsCommand(rawArgs.slice(1));
    return;
  }

  // Split args at "--" separator
  const separatorIndex = rawArgs.indexOf("--");
  const ccGlmArgs = separatorIndex >= 0 ? rawArgs.slice(0, separatorIndex) : rawArgs;
  const claudeArgs = separatorIndex >= 0 ? rawArgs.slice(separatorIndex + 1) : [];

  // Handle cc-glm own flags
  if (ccGlmArgs.includes("--help") || ccGlmArgs.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  if (ccGlmArgs.includes("--version") || ccGlmArgs.includes("-v")) {
    printVersion();
    process.exit(0);
  }

  // Reject unknown flags
  if (ccGlmArgs.length > 0) {
    process.stderr.write(`Unknown option: ${ccGlmArgs[0]}\n\n`);
    printHelp();
    process.exit(1);
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

  // Forward claude arguments
  logger.info(`Starting claude with args: ${claudeArgs.join(" ") || "(no args)"}`, { component: "cli" });

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
