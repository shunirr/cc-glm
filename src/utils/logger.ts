/**
 * Structured logging with dual output: JSONL to file, plain text to stderr
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LoggingConfig } from "../config/types.js";
import type { LogEntry, LogContext } from "./log-types.js";

/** Log level values for comparison */
const LOG_LEVEL_VALUES: Record<LoggingConfig["level"], number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Format log level for human-readable output */
function formatLevel(level: LogEntry["level"]): string {
  return level.toUpperCase().padEnd(5);
}

/** Format extra fields for human-readable output */
function formatFields(fields: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

/** Logger class with dual output: JSONL file + stderr plain text */
export class Logger {
  private level: number;
  private logFilePath: string | undefined;
  private writeToStderr: boolean;

  constructor(config: LoggingConfig, options?: { logFilePath?: string; stderr?: boolean }) {
    this.level = LOG_LEVEL_VALUES[config.level];
    this.logFilePath = options?.logFilePath ?? config.file;
    this.writeToStderr = options?.stderr ?? true;

    // Ensure log file directory exists
    if (this.logFilePath) {
      try {
        mkdirSync(dirname(this.logFilePath), { recursive: true });
      } catch {
        // Directory may already exist
      }
    }
  }

  /** Create a child logger with bound context */
  child(ctx: LogContext): ChildLogger {
    return new ChildLogger(this, ctx);
  }

  /** Check if a level should be logged */
  private shouldLog(level: LogEntry["level"]): boolean {
    return LOG_LEVEL_VALUES[level] >= this.level;
  }

  /** Core log method */
  log(level: LogEntry["level"], msg: string, fields?: LogContext): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...fields,
    };

    // Write JSONL to file
    if (this.logFilePath) {
      try {
        appendFileSync(this.logFilePath, JSON.stringify(entry) + "\n");
      } catch {
        // Silently ignore file write errors to avoid recursive logging
      }
    }

    // Write plain text to stderr
    if (this.writeToStderr) {
      const prefix = `[${entry.ts}] ${formatLevel(level)}`;
      const component = entry.component ? `[${entry.component}]` : "";
      const reqId = entry.reqId ? `[${entry.reqId}]` : "";
      const extra: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(entry)) {
        if (!["ts", "level", "msg", "component", "reqId"].includes(key) && value !== undefined) {
          extra[key] = value;
        }
      }
      const fieldsStr = formatFields(extra);
      process.stderr.write(`${prefix} ${component}${reqId} ${msg}${fieldsStr}\n`);
    }
  }

  /** Log debug message */
  debug(msg: string, fields?: LogContext): void {
    this.log("debug", msg, fields);
  }

  /** Log info message */
  info(msg: string, fields?: LogContext): void {
    this.log("info", msg, fields);
  }

  /** Log warning message */
  warn(msg: string, fields?: LogContext): void {
    this.log("warn", msg, fields);
  }

  /** Log error message */
  error(msg: string, fields?: LogContext): void {
    this.log("error", msg, fields);
  }

  /** Update log level */
  setLevel(level: LoggingConfig["level"]): void {
    this.level = LOG_LEVEL_VALUES[level];
  }

  /** Get the log file path */
  getLogFilePath(): string | undefined {
    return this.logFilePath;
  }
}

/** Child logger that adds bound context to every log entry */
export class ChildLogger {
  private parent: Logger;
  private ctx: LogContext;

  constructor(parent: Logger, ctx: LogContext) {
    this.parent = parent;
    this.ctx = ctx;
  }

  /** Log debug message */
  debug(msg: string, fields?: LogContext): void {
    this.parent.log("debug", msg, { ...this.ctx, ...fields });
  }

  /** Log info message */
  info(msg: string, fields?: LogContext): void {
    this.parent.log("info", msg, { ...this.ctx, ...fields });
  }

  /** Log warning message */
  warn(msg: string, fields?: LogContext): void {
    this.parent.log("warn", msg, { ...this.ctx, ...fields });
  }

  /** Log error message */
  error(msg: string, fields?: LogContext): void {
    this.parent.log("error", msg, { ...this.ctx, ...fields });
  }
}
