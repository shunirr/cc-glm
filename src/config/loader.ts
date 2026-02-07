/**
 * Configuration loader for cc-glm
 * Handles YAML parsing, environment variable expansion, and validation
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  Config,
  ProxyConfig,
  UpstreamConfig,
  LifecycleConfig,
  LoggingConfig,
  RoutingConfig,
  SignatureStoreConfig,
  RawConfig,
} from "./types.js";

// Valid upstream names
const VALID_UPSTREAMS = new Set(["anthropic", "zai"]);

// Valid log levels
const VALID_LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);

/** Default configuration values */
const DEFAULTS: Config = {
  proxy: {
    port: 8787,
    host: "127.0.0.1",
  },
  upstream: {
    anthropic: {
      url: "https://api.anthropic.com",
    },
    zai: {
      url: "https://api.z.ai/api/anthropic",
      apiKey: "",
    },
  },
  lifecycle: {
    stopGraceSeconds: 8,
    startWaitSeconds: 8,
    stateDir: `${process.env.TMPDIR ?? "/tmp"}/claude-code-proxy`,
  },
  logging: {
    level: "info",
  },
  routing: {
    rules: [],
    default: "anthropic",
  },
};

/**
 * Expand environment variables in a string
 * Supports ${VAR} and ${VAR:-default} syntax
 */
function expandEnvVars(str: string): string {
  if (typeof str !== "string") return str;
  return str.replace(/\$\{([^}:]+)(:-([^}]*))?\}/g, (_, name, _defaultValue, defaultValue) => {
    return process.env[name] ?? defaultValue ?? "";
  });
}

/**
 * Get the default configuration file path
 */
export function getDefaultConfigPath(): string {
  const home = process.env.HOME ?? "";
  return join(home, ".config", "cc-glm", "config.yml");
}

/**
 * Load configuration from a YAML file
 */
export async function loadConfig(filePath: string = getDefaultConfigPath()): Promise<Config> {
  let raw: RawConfig = {};

  // Load from file if exists
  if (existsSync(filePath)) {
    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = parseYaml(content) as RawConfig;
      if (parsed && typeof parsed === "object") {
        raw = parsed;
      }
    } catch (error) {
      throw new Error(`Failed to parse config file at ${filePath}: ${error}`);
    }
  }

  // Merge with defaults and validate
  return mergeAndValidateConfig(raw);
}

/**
 * Merge raw config with defaults, validate, and apply environment variable expansion
 */
function mergeAndValidateConfig(raw: RawConfig): Config {
  const config: Config = {
    proxy: mergeProxyConfig(raw.proxy),
    upstream: mergeUpstreamConfig(raw.upstream),
    lifecycle: mergeLifecycleConfig(raw.lifecycle),
    logging: mergeLoggingConfig(raw.logging),
    routing: mergeRoutingConfig(raw.routing),
    signatureStore: mergeSignatureStoreConfig(raw.signature_store),
  };

  // Validate configuration
  validateConfig(config);

  return config;
}

function mergeProxyConfig(raw?: Partial<ProxyConfig>): ProxyConfig {
  const rawPort = raw?.port;

  // Validate port is a valid number
  let port: number;
  if (typeof rawPort === "number" && Number.isFinite(rawPort) && !isNaN(rawPort)) {
    port = rawPort;
  } else {
    port = DEFAULTS.proxy.port;
  }

  // Validate port is in valid range and is an integer
  if (!Number.isInteger(port)) {
    throw new Error(`Invalid port: ${port}. Must be an integer.`);
  }
  if (port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}. Must be between 1 and 65535.`);
  }

  // Validate host is a string
  const rawHost = raw?.host;
  const host = typeof rawHost === "string" ? rawHost : DEFAULTS.proxy.host;
  if (typeof host !== "string" || host.length === 0) {
    throw new Error(`Invalid host: must be a non-empty string.`);
  }

  return {
    host,
    port,
  };
}

function mergeUpstreamConfig(raw?: Partial<UpstreamConfig>): UpstreamConfig {
  const rawAnthropic = raw?.anthropic;
  const rawZai = raw?.zai;

  return {
    anthropic: {
      url: rawAnthropic?.url ? expandEnvVars(rawAnthropic.url) : DEFAULTS.upstream.anthropic.url,
    },
    zai: {
      url: rawZai?.url ? expandEnvVars(rawZai.url) : DEFAULTS.upstream.zai.url,
      apiKey:
        expandEnvVars(rawZai?.apiKey ?? "") ||
        process.env.ZAI_API_KEY ||
        DEFAULTS.upstream.zai.apiKey,
    },
  };
}

function mergeLifecycleConfig(raw?: Partial<LifecycleConfig>): LifecycleConfig {
  // Use user-provided stateDir or default
  const stateDir = raw?.stateDir ?? DEFAULTS.lifecycle.stateDir;
  const expandedStateDir = expandEnvVars(typeof stateDir === "string" ? stateDir : DEFAULTS.lifecycle.stateDir);

  // Only fall back to default if expansion resulted in empty string
  // Otherwise respect the user's configuration
  const finalStateDir = expandedStateDir || `${process.env.TMPDIR || "/tmp"}/claude-code-proxy`;

  // Validate stateDir is a non-empty string
  if (typeof finalStateDir !== "string" || finalStateDir.length === 0) {
    throw new Error(`Invalid stateDir: must be a non-empty string.`);
  }

  // Validate numeric values
  const rawStopGrace = raw?.stopGraceSeconds;
  const rawStartWait = raw?.startWaitSeconds;

  // Validate stopGraceSeconds
  let stopGraceSeconds: number;
  if (typeof rawStopGrace === "number" && Number.isFinite(rawStopGrace) && !isNaN(rawStopGrace)) {
    stopGraceSeconds = rawStopGrace;
  } else {
    stopGraceSeconds = DEFAULTS.lifecycle.stopGraceSeconds;
  }

  if (!Number.isInteger(stopGraceSeconds)) {
    throw new Error(`Invalid stopGraceSeconds: ${stopGraceSeconds}. Must be an integer.`);
  }
  if (stopGraceSeconds < 0 || stopGraceSeconds > 300) {
    throw new Error(`Invalid stopGraceSeconds: ${stopGraceSeconds}. Must be between 0 and 300.`);
  }

  // Validate startWaitSeconds
  let startWaitSeconds: number;
  if (typeof rawStartWait === "number" && Number.isFinite(rawStartWait) && !isNaN(rawStartWait)) {
    startWaitSeconds = rawStartWait;
  } else {
    startWaitSeconds = DEFAULTS.lifecycle.startWaitSeconds;
  }

  if (!Number.isInteger(startWaitSeconds)) {
    throw new Error(`Invalid startWaitSeconds: ${startWaitSeconds}. Must be an integer.`);
  }
  if (startWaitSeconds < 1 || startWaitSeconds > 60) {
    throw new Error(`Invalid startWaitSeconds: ${startWaitSeconds}. Must be between 1 and 60.`);
  }

  return {
    stopGraceSeconds,
    startWaitSeconds,
    stateDir: finalStateDir,
  };
}

function mergeLoggingConfig(raw?: Partial<LoggingConfig>): LoggingConfig {
  const level = raw?.level ?? DEFAULTS.logging.level;

  // Validate log level
  if (!VALID_LOG_LEVELS.has(level)) {
    throw new Error(`Invalid logging level: ${level}. Must be one of: ${Array.from(VALID_LOG_LEVELS).join(", ")}`);
  }

  return {
    level,
  };
}

function mergeRoutingConfig(raw?: Partial<RoutingConfig>): RoutingConfig {
  const rules = raw?.rules ?? DEFAULTS.routing.rules;
  const defaultUpstream = raw?.default ?? DEFAULTS.routing.default;

  // Validate rules is an array
  if (!Array.isArray(rules)) {
    throw new Error(`Invalid routing.rules: must be an array, got ${typeof rules}`);
  }

  // Validate each rule
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (!rule || typeof rule !== "object") {
      throw new Error(`Invalid routing rule at index ${i}: must be an object`);
    }
    if (typeof rule.match !== "string") {
      throw new Error(`Invalid routing rule at index ${i}: match must be a string`);
    }
    if (typeof rule.upstream !== "string") {
      throw new Error(`Invalid routing rule at index ${i}: upstream must be a string`);
    }
    if (!VALID_UPSTREAMS.has(rule.upstream)) {
      throw new Error(
        `Invalid routing rule at index ${i}: upstream "${rule.upstream}" is not valid. Must be one of: ${Array.from(VALID_UPSTREAMS).join(", ")}`
      );
    }
    if (rule.model !== undefined && typeof rule.model !== "string") {
      throw new Error(`Invalid routing rule at index ${i}: model must be a string if provided`);
    }
  }

  // Validate default upstream
  if (!VALID_UPSTREAMS.has(defaultUpstream)) {
    throw new Error(
      `Invalid routing.default: "${defaultUpstream}" is not valid. Must be one of: ${Array.from(VALID_UPSTREAMS).join(", ")}`
    );
  }

  return {
    rules,
    default: defaultUpstream,
  };
}

function mergeSignatureStoreConfig(raw?: Partial<SignatureStoreConfig>): SignatureStoreConfig {
  const DEFAULT_MAX_SIZE = 1000;
  const rawMaxSize = raw?.maxSize;

  let maxSize: number;
  if (typeof rawMaxSize === "number" && Number.isFinite(rawMaxSize) && !isNaN(rawMaxSize)) {
    maxSize = rawMaxSize;
  } else {
    maxSize = DEFAULT_MAX_SIZE;
  }

  if (!Number.isInteger(maxSize)) {
    throw new Error(`Invalid signatureStore.maxSize: ${maxSize}. Must be an integer.`);
  }
  if (maxSize < 1 || maxSize > 100000) {
    throw new Error(`Invalid signatureStore.maxSize: ${maxSize}. Must be between 1 and 100000.`);
  }

  return { maxSize };
}

/**
 * Validate the complete configuration
 */
function validateConfig(config: Config): void {
  // Validate URLs
  try {
    new URL(config.upstream.anthropic.url);
  } catch {
    throw new Error(`Invalid anthropic URL: ${config.upstream.anthropic.url}`);
  }

  try {
    new URL(config.upstream.zai.url);
  } catch {
    throw new Error(`Invalid zai URL: ${config.upstream.zai.url}`);
  }

  // Warn if zai API key is empty
  if (!config.upstream.zai.apiKey) {
    console.warn("Warning: zai API key is not set. Requests to z.ai will fail without ZAI_API_KEY.");
  }
}
