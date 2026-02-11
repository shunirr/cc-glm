/**
 * Log tail mode: reads JSONL log file and displays with chalk coloring
 */

import { createReadStream, existsSync, statSync, watchFile, unwatchFile } from "node:fs";
import { createInterface } from "node:readline";
import chalk from "chalk";
import type { LogEntry } from "../utils/log-types.js";

/** Log level values for filtering */
const LOG_LEVEL_VALUES: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Color formatting per log level */
function colorLevel(level: string): string {
  switch (level) {
    case "debug":
      return chalk.dim.white(level.toUpperCase().padEnd(5));
    case "info":
      return chalk.cyan(level.toUpperCase().padEnd(5));
    case "warn":
      return chalk.yellow(level.toUpperCase().padEnd(5));
    case "error":
      return chalk.red(level.toUpperCase().padEnd(5));
    default:
      return level.toUpperCase().padEnd(5);
  }
}

/** Format a LogEntry for display */
function formatEntry(entry: LogEntry): string {
  const ts = chalk.dim.white(new Date(entry.ts).toLocaleTimeString("en-GB", { hour12: false }));
  const level = colorLevel(entry.level);
  const component = entry.component ? chalk.blue(`[${entry.component}]`) : "";
  const reqId = entry.reqId ? chalk.magenta(`[${entry.reqId}]`) : "";
  const msg = entry.msg;

  // Collect extra fields
  const extras: string[] = [];
  const skipKeys = new Set(["ts", "level", "msg", "component", "reqId"]);
  for (const [key, value] of Object.entries(entry)) {
    if (skipKeys.has(key) || value === undefined || value === null) continue;
    if (key === "bodyExcerpt") {
      extras.push(`${chalk.dim.white(key)}=${chalk.dim(String(value).slice(0, 200))}`);
    } else {
      extras.push(`${chalk.dim.white(key)}=${String(value)}`);
    }
  }

  const extrasStr = extras.length > 0 ? ` ${extras.join(" ")}` : "";
  return `${ts} ${level} ${component}${reqId} ${msg}${extrasStr}`;
}

/** Tail logs from a JSONL file */
export async function tailLogs(
  logFilePath: string,
  options: { level?: string; follow?: boolean } = {}
): Promise<void> {
  const minLevel = LOG_LEVEL_VALUES[options.level ?? "debug"] ?? 0;
  const follow = options.follow ?? true;

  if (!existsSync(logFilePath)) {
    if (follow) {
      process.stderr.write(`Waiting for log file: ${logFilePath}\n`);
      // Wait for the file to appear
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (existsSync(logFilePath)) {
            clearInterval(interval);
            resolve();
          }
        }, 500);
      });
    } else {
      process.stderr.write(`Log file not found: ${logFilePath}\n`);
      process.exit(1);
    }
  }

  // Read existing content
  await readAndPrint(logFilePath, 0, minLevel);

  if (!follow) return;

  // Watch for changes
  let lastSize = statSync(logFilePath).size;

  watchFile(logFilePath, { interval: 300 }, async (curr) => {
    if (curr.size > lastSize) {
      await readAndPrint(logFilePath, lastSize, minLevel);
      lastSize = curr.size;
    } else if (curr.size < lastSize) {
      // File was truncated, read from beginning
      await readAndPrint(logFilePath, 0, minLevel);
      lastSize = curr.size;
    }
  });

  // Handle graceful shutdown
  const cleanup = () => {
    unwatchFile(logFilePath);
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep process alive
  await new Promise<void>(() => {
    // Never resolves - keeps the process running until interrupted
  });
}

/** Read JSONL file from a byte offset and print formatted entries */
async function readAndPrint(filePath: string, startByte: number, minLevel: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { start: startByte, encoding: "utf-8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const entry = JSON.parse(line) as LogEntry;
        const entryLevel = LOG_LEVEL_VALUES[entry.level] ?? 0;
        if (entryLevel >= minLevel) {
          process.stdout.write(formatEntry(entry) + "\n");
        }
      } catch {
        // Skip malformed lines
      }
    });

    rl.on("close", resolve);
    rl.on("error", reject);
  });
}
