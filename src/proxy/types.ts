/**
 * Type definitions for proxy functionality
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Config } from "../config/types.js";

/** Upstream route target */
export interface Route {
  name: "anthropic" | "zai";
  url: string;
  apiKey: string;
}

/** Request body with model field */
export interface RequestBody {
  model?: string;
  [key: string]: unknown;
}

/** HTTP request handler */
export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;
