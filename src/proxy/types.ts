/**
 * Type definitions for proxy functionality
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** Upstream route target */
export interface Route {
  name: string;
  url: string;
  apiKey?: string;
  model?: string;
}

/** Request body with model field */
export interface RequestBody {
  model?: string;
  [key: string]: unknown;
}

/** HTTP request handler */
export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Content block types in Messages API
 */
export interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

export interface Message {
  role: string;
  content: string | ContentBlock[];
}

export interface MessageRequestBody {
  model?: string;
  messages?: Message[];
  [key: string]: unknown;
}
