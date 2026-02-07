/**
 * Model-based routing logic
 * Routes glm-* models to z.ai, others to Anthropic API
 */

import type { Config, Route } from "./types.js";

/**
 * Select upstream route based on model name
 * @param model - Model name from request body
 * @param config - Configuration containing upstream URLs and API keys
 * @returns Selected route
 */
export function selectRoute(model: string | undefined, config: Config): Route {
  // GLM models route to z.ai
  if (typeof model === "string" && model.startsWith("glm")) {
    return {
      name: "zai",
      url: config.upstream.zai.url,
      apiKey: config.upstream.zai.apiKey,
    };
  }

  // Default to Anthropic
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
