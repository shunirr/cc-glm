/**
 * Structured log entry types for JSONL output
 */

export interface LogEntry {
  ts: string; // ISO 8601 timestamp
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  component?: "proxy" | "lifecycle" | "config" | "router" | "cli";
  reqId?: string; // Per-request tracking ID
  model?: string;
  upstream?: string;
  method?: string;
  path?: string;
  status?: number; // HTTP status code
  bodyExcerpt?: string; // Response body excerpt (max 500 chars)
  durationMs?: number;
  errorCode?: string; // e.g. "ECONNREFUSED", "ETIMEDOUT"
  [key: string]: unknown;
}

/** Context fields that can be bound to a child logger */
export type LogContext = Omit<Partial<LogEntry>, "ts" | "level" | "msg">;
