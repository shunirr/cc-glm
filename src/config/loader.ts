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
  RawConfig,
} from "./types.js";

/** Default configuration values */
const DEFAULTS = {
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
    level: "info" as const,
  },
  routing: {
    rules: [],
    default: "anthropic",
  },
} satisfies Config;

/**
 * Expand environment variables in a string
 * Supports ${VAR} and ${VAR:-default} syntax
 */
function expandEnvVars(str: string): string {
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

  // Merge with defaults
  return mergeConfig(raw);
}

/**
 * Merge raw config with defaults and apply environment variable expansion
 */
function mergeConfig(raw: RawConfig): Config {
  return {
    proxy: mergeProxyConfig(raw.proxy),
    upstream: mergeUpstreamConfig(raw.upstream),
    lifecycle: mergeLifecycleConfig(raw.lifecycle),
    logging: mergeLoggingConfig(raw.logging),
    routing: mergeRoutingConfig(raw.routing),
  };
}

function mergeProxyConfig(raw?: Partial<ProxyConfig>): ProxyConfig {
  return {
    host: raw?.host ?? DEFAULTS.proxy.host,
    port: raw?.port ?? DEFAULTS.proxy.port,
  };
}

function mergeUpstreamConfig(raw?: Partial<UpstreamConfig>): UpstreamConfig {
  const rawAnthropic = raw?.anthropic;
  const rawZai = raw?.zai;

  return {
    anthropic: {
      url: rawAnthropic?.url ?? DEFAULTS.upstream.anthropic.url,
    },
    zai: {
      url: rawZai?.url ?? DEFAULTS.upstream.zai.url,
      apiKey:
        expandEnvVars(rawZai?.apiKey ?? "") ||
        process.env.ZAI_API_KEY ||
        DEFAULTS.upstream.zai.apiKey,
    },
  };
}

function mergeLifecycleConfig(raw?: Partial<LifecycleConfig>): LifecycleConfig {
  const stateDir = raw?.stateDir ?? DEFAULTS.lifecycle.stateDir;
  const expandedStateDir = expandEnvVars(stateDir);

  // If expansion resulted in empty path part, use default
  const finalStateDir = expandedStateDir.includes("/claude-code-proxy")
    ? expandedStateDir
    : `${process.env.TMPDIR || "/tmp"}/claude-code-proxy`;

  return {
    stopGraceSeconds: raw?.stopGraceSeconds ?? DEFAULTS.lifecycle.stopGraceSeconds,
    startWaitSeconds: raw?.startWaitSeconds ?? DEFAULTS.lifecycle.startWaitSeconds,
    stateDir: finalStateDir,
  };
}

function mergeLoggingConfig(raw?: Partial<LoggingConfig>): LoggingConfig {
  return {
    level: raw?.level ?? DEFAULTS.logging.level,
  };
}

function mergeRoutingConfig(raw?: Partial<RoutingConfig>): RoutingConfig {
  return {
    rules: raw?.rules ?? DEFAULTS.routing.rules,
    default: raw?.default ?? DEFAULTS.routing.default,
  };
}
