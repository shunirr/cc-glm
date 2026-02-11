/**
 * Model-based routing logic
 * Routes requests to upstream based on config routing rules
 */

import type { Config } from "../config/types.js";
import type { Route } from "./types.js";
import type { ChildLogger } from "../utils/logger.js";

// Valid upstream names
const VALID_UPSTREAMS = new Set(["anthropic", "zai"]);

/**
 * Convert a glob-style pattern to a RegExp
 * Only supports `*` as wildcard (matches any characters)
 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = "^" + escaped.replace(/\*/g, ".*") + "$";
  return new RegExp(regexStr);
}

/**
 * Validate upstream name
 */
export function isValidUpstream(name: string): boolean {
  return VALID_UPSTREAMS.has(name);
}

/**
 * Select upstream route based on model name and config routing rules
 * Rules are evaluated top-to-bottom, first match wins
 *
 * If model is undefined, only rules with match="*" will be applied.
 * Otherwise, falls back to default upstream.
 */
export function selectRoute(model: string | undefined, config: Config, logger?: ChildLogger): Route {
  const modelToMatch = model ?? "";

  for (const rule of config.routing.rules) {
    // Validate upstream name at runtime
    if (!isValidUpstream(rule.upstream)) {
      logger?.warn(`Invalid upstream name in routing rule: ${rule.upstream}`);
      continue;
    }

    // Try to match the pattern against the model (or empty string for model-less requests)
    if (globToRegExp(rule.match).test(modelToMatch)) {
      if (rule.upstream === "anthropic") {
        return {
          name: "anthropic",
          url: config.upstream.anthropic.url,
          model: rule.model,
        };
      } else {
        // zai
        return {
          name: "zai",
          url: config.upstream.zai.url,
          apiKey: config.upstream.zai.apiKey,
          model: rule.model,
        };
      }
    }
  }

  // Fall back to default upstream
  const defaultName = config.routing.default;

  // Validate default upstream name
  if (!isValidUpstream(defaultName)) {
    logger?.warn(`Invalid default upstream name: ${defaultName}, falling back to anthropic`);
    return {
      name: "anthropic",
      url: config.upstream.anthropic.url,
    };
  }

  if (defaultName === "anthropic") {
    return {
      name: "anthropic",
      url: config.upstream.anthropic.url,
    };
  } else {
    return {
      name: "zai",
      url: config.upstream.zai.url,
      apiKey: config.upstream.zai.apiKey,
    };
  }
}

/**
 * Parse model name from request body
 * @param body - Request body as buffer
 * @returns Parsed body with model field, or null if parsing fails
 */
export function parseRequestBody(body: Buffer): { model?: string } | null {
  try {
    const parsed = JSON.parse(body.toString()) as { model?: string };
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Parse request body and validate it's an object
 * Returns null if body is not an object or is null/array
 */
export function parseRequestBodyAsObject(body: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body.toString());
    // Ensure parsed value is a non-null object and not an array
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
