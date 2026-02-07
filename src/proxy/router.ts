/**
 * Model-based routing logic
 * Routes requests to upstream based on config routing rules
 */

import type { Config } from "../config/types.js";
import type { Route } from "./types.js";

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
 * Select upstream route based on model name and config routing rules
 * Rules are evaluated top-to-bottom, first match wins
 */
export function selectRoute(model: string | undefined, config: Config): Route {
  if (typeof model === "string") {
    for (const rule of config.routing.rules) {
      if (globToRegExp(rule.match).test(model)) {
        const upstream = config.upstream[rule.upstream as keyof typeof config.upstream];
        if (upstream) {
          return {
            name: rule.upstream,
            url: upstream.url,
            apiKey: upstream.apiKey,
            model: rule.model,
          };
        }
      }
    }
  }

  // Fall back to default upstream
  const defaultName = config.routing.default;
  const defaultUpstream = config.upstream[defaultName as keyof typeof config.upstream];
  if (defaultUpstream) {
    return {
      name: defaultName,
      url: defaultUpstream.url,
      apiKey: defaultUpstream.apiKey,
    };
  }

  // Ultimate fallback to anthropic
  return {
    name: "anthropic",
    url: config.upstream.anthropic.url,
    apiKey: config.upstream.anthropic.apiKey,
  };
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
