/**
 * Logging utilities
 */

import chalk from "chalk";
import type { LoggingConfig } from "../config/types.js";

/** Log level values for comparison */
const LOG_LEVEL_VALUES: Record<LoggingConfig["level"], number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Logger class */
export class Logger {
  private config: LoggingConfig;

  constructor(config: LoggingConfig) {
    this.config = config;
  }

  /** Update log level */
  setLevel(level: LoggingConfig["level"]): void {
    this.config.level = level;
  }

  /** Check if a message should be logged */
  private shouldLog(level: LoggingConfig["level"]): boolean {
    return LOG_LEVEL_VALUES[level] >= LOG_LEVEL_VALUES[this.config.level];
  }

  /** Format log message */
  private format(level: LoggingConfig["level"], message: string): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    return `[${timestamp}] ${levelStr} ${message}`;
  }

  /** Log debug message */
  debug(message: string): void {
    if (this.shouldLog("debug")) {
      console.log(chalk.gray(this.format("debug", message)));
    }
  }

  /** Log info message */
  info(message: string): void {
    if (this.shouldLog("info")) {
      console.log(chalk.white(this.format("info", message)));
    }
  }

  /** Log warning message */
  warn(message: string): void {
    if (this.shouldLog("warn")) {
      console.log(chalk.yellow(this.format("warn", message)));
    }
  }

  /** Log error message */
  error(message: string): void {
    if (this.shouldLog("error")) {
      console.log(chalk.red(this.format("error", message)));
    }
  }
}
