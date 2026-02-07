/**
 * HTTP Proxy Server for Claude Code
 * Routes requests to Anthropic API or z.ai based on model name
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import type { Config } from "../config/types.js";
import type { Route } from "./types.js";
import { selectRoute, parseRequestBody, parseRequestBodyAsObject } from "./router.js";
import { loadConfig } from "../config/loader.js";
import { transformThinkingBlocks, shouldTransformResponse, sanitizeContentBlocks, shouldTransformRequest } from "./transform.js";

/**
 * Hop-by-hop headers that should not be forwarded per RFC 7230
 * Also includes headers that could cause security issues
 */
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
]);

/**
 * Headers that should be removed to prevent spoofing (RFC 7239 and security)
 */
const SECURITY_HEADERS_TO_REMOVE = new Set([
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-real-ip",
  "forwarded",
]);

/**
 * Maximum request body size (10MB)
 */
const MAX_BODY_SIZE = 10 * 1024 * 1024;

/**
 * Maximum transform response size (50MB) to prevent memory DoS
 */
const MAX_TRANSFORM_SIZE = 50 * 1024 * 1024;

/**
 * Upstream request timeout (30 seconds)
 */
const UPSTREAM_TIMEOUT_MS = 30_000;

/** Create and start the proxy server */
export function createProxyServer(config: Config): Server {
  const server = createServer(async (req, res) => {
    await handleRequest(req, res, config);
  });

  const { port, host } = config.proxy;
  server.listen(port, host, () => {
    console.log(`Claude Router Proxy on :${port}`);
    console.log(`  anthropic -> ${config.upstream.anthropic.url}`);
    console.log(`  zai       -> ${config.upstream.zai.url}`);
    if (config.routing.rules.length > 0) {
      console.log(`  routing rules: ${config.routing.rules.length}, default: ${config.routing.default}`);
    }
  });

  return server;
}

/** Handle incoming HTTP request */
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: Config
): Promise<void> {
  const reqId = Date.now().toString(36);
  let requestBody: Buffer | null = null;
  let proxyReq: ReturnType<typeof httpsRequest | typeof httpRequest> | null = null;
  let isAborted = false;

  // Register abort handlers early to catch early disconnects
  const onAborted = () => {
    console.log(`[${reqId}] Client aborted`);
    isAborted = true;
    if (proxyReq) {
      proxyReq.destroy();
    }
  };

  const onError = (err: Error) => {
    console.error(`[${reqId}] Request error: ${err.message}`);
    isAborted = true;
    if (proxyReq) {
      proxyReq.destroy();
    }
  };

  req.once("aborted", onAborted);
  req.once("error", onError);

  try {
    // Determine if we should buffer the body based on headers
    const method = req.method ?? "GET";
    const needsBody = hasRequestBody(req);

    // Parse model from request body if needed
    let target: Route;
    let model = "no-model";
    let bodyWasRewritten = false;

    if (needsBody) {
      // Buffer request body with size limit
      const chunks: Buffer[] = [];
      let totalSize = 0;

      for await (const chunk of req) {
        if (isAborted) return;
        totalSize += (chunk as Buffer).length;
        if (totalSize > MAX_BODY_SIZE) {
          if (!res.headersSent) {
            res.writeHead(413, { "content-type": "application/json" });
          }
          res.end(JSON.stringify({ error: "payload_too_large", message: "Request body exceeds maximum size" }));
          return;
        }
        chunks.push(chunk as Buffer);
      }
      if (isAborted) return;
      requestBody = Buffer.concat(chunks);

      const parsed = parseRequestBody(requestBody);
      if (parsed) {
        model = parsed.model || "no-model";
      }
      target = selectRoute(parsed?.model, config);
    } else {
      target = selectRoute(undefined, config);
    }

    // Rewrite model name in request body if route specifies a different model
    let forwardBody: Buffer;
    if (needsBody && requestBody && target.model) {
      const bodyObj = parseRequestBodyAsObject(requestBody);
      if (bodyObj) {
        bodyObj.model = target.model;
        forwardBody = Buffer.from(JSON.stringify(bodyObj));
        bodyWasRewritten = true;
        console.log(`[${reqId}] model rewrite: ${model} -> ${target.model}`);
      } else {
        forwardBody = requestBody;
      }
    } else {
      forwardBody = (needsBody && requestBody) || Buffer.alloc(0);
    }

    // Sanitize content blocks for Anthropic API
    // Removes z.ai specific fields from thinking blocks in message history
    if (needsBody && forwardBody.length > 0) {
      const contentType = req.headers["content-type"];
      if (shouldTransformRequest(contentType, target.name)) {
        const originalBody = forwardBody.toString();
        const sanitized = sanitizeContentBlocks(originalBody);
        if (sanitized !== originalBody) {
          forwardBody = Buffer.from(sanitized);
          bodyWasRewritten = true;
          console.log(`[${reqId}] sanitized request content blocks for Anthropic`);
        }
      }
    }

    // Build upstream URL (handle undefined req.url)
    const reqUrl = req.url ?? "/";
    const baseUrl = new URL(target.url);
    const basePath = baseUrl.pathname.replace(/\/$/, "");
    const upstreamUrl = new URL(basePath + reqUrl, baseUrl.origin);
    const isHttps = upstreamUrl.protocol === "https:";
    const doRequest = isHttps ? httpsRequest : httpRequest;

    console.log(`[${reqId}] ${method} ${reqUrl} model=${model} -> ${target.name}`);

    // Prepare headers with proper filtering
    const forwardHeaders = buildForwardHeaders(req.headers, target, forwardBody, bodyWasRewritten);

    // Forward request
    proxyReq = doRequest(
      upstreamUrl,
      { method, headers: forwardHeaders, timeout: UPSTREAM_TIMEOUT_MS },
      (proxyRes) => {
        if (isAborted) {
          proxyRes.destroy();
          return;
        }

        console.log(`[${reqId}] <- ${proxyRes.statusCode}`);

        // Check if we need to transform the response
        const contentType = proxyRes.headers["content-type"];
        const needsTransform = shouldTransformResponse(contentType, target.name);

        // Build response headers, removing hop-by-hop headers
        const resHeaders = buildResponseHeaders(proxyRes.headers, needsTransform);

        if (needsTransform) {
          // Buffer the response for transformation with size limit
          const chunks: Buffer[] = [];
          let totalSize = 0;

          proxyRes.on("data", (chunk) => {
            if (isAborted) return;
            totalSize += chunk.length;
            if (totalSize > MAX_TRANSFORM_SIZE) {
              console.error(`[${reqId}] Transform buffer exceeded limit`);
              proxyRes.destroy();
              if (!res.headersSent) {
                res.writeHead(502, { "content-type": "application/json" });
              }
              res.end(JSON.stringify({ error: "transform_error", message: "Response too large to transform" }));
              return;
            }
            chunks.push(chunk);
          });

          proxyRes.on("end", () => {
            req.off("aborted", onAborted);
            req.off("error", onError);
            if (isAborted) return;
            try {
              const body = Buffer.concat(chunks).toString();
              const transformed = transformThinkingBlocks(body);
              resHeaders["content-length"] = String(Buffer.byteLength(transformed));
              res.writeHead(proxyRes.statusCode || 200, resHeaders);
              res.end(transformed);
            } catch (err) {
              const error = err as Error;
              console.error(`[${reqId}] Transform error: ${error.message}`);
              if (!res.headersSent) {
                res.writeHead(502, { "content-type": "application/json" });
              }
              res.end(JSON.stringify({ error: "transform_error", message: error.message }));
            }
          });
        } else {
          req.off("aborted", onAborted);
          req.off("error", onError);
          // Stream response directly without transformation
          res.writeHead(proxyRes.statusCode || 200, resHeaders);
          proxyRes.pipe(res);
        }
      }
    );

    // Set up timeout for upstream request
    if (proxyReq.setTimeout) {
      proxyReq.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
        console.error(`[${reqId}] Upstream timeout`);
        isAborted = true;
        proxyReq?.destroy();
        req.off("aborted", onAborted);
        req.off("error", onError);
        if (!res.headersSent) {
          res.writeHead(504, { "content-type": "application/json" });
        }
        res.end(JSON.stringify({ error: "gateway_timeout", message: "Upstream timeout" }));
      });
    }

    // Handle upstream request errors
    proxyReq.on("error", (err) => {
      if (isAborted) return;
      console.error(`[${reqId}] Upstream error: ${err.message}`);
      req.off("aborted", onAborted);
      req.off("error", onError);
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: "proxy_error", message: err.message }));
    });

    // Handle proxy response errors
    proxyReq.on("response", (proxyRes) => {
      proxyRes.on("error", (err) => {
        console.error(`[${reqId}] Response error: ${err.message}`);
        if (!res.writableEnded) {
          res.end();
        }
      });
    });

    // Send body if present
    if (forwardBody && forwardBody.length > 0) {
      proxyReq.write(forwardBody);
    }
    proxyReq.end();
  } catch (err) {
    const error = err as Error;
    console.error(`[${reqId}] ERROR: ${error.message}`);
    if (proxyReq) {
      proxyReq.destroy();
    }
    req.off("aborted", onAborted);
    req.off("error", onError);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: "proxy_error", message: error.message }));
  }
}

/**
 * Determine if request has a body based on method and headers
 */
function hasRequestBody(req: IncomingMessage): boolean {
  const method = (req.method ?? "GET").toUpperCase();

  // Methods that typically have a body
  const bodyMethods = new Set(["POST", "PUT", "PATCH"]);

  if (bodyMethods.has(method)) {
    return true;
  }

  // Check for content-length or transfer-encoding headers
  // Some APIs use body with DELETE or other methods
  const contentLength = req.headers["content-length"];
  const transferEncoding = req.headers["transfer-encoding"];

  return (
    (contentLength && parseInt(contentLength, 10) > 0) ||
    !!transferEncoding
  );
}

/**
 * Parse Connection header to extract additional hop-by-hop header names
 * per RFC 7230 Section 6.1
 */
function parseConnectionHeader(connection: string | string[] | undefined): Set<string> {
  const additionalHeaders = new Set<string>();

  if (!connection) return additionalHeaders;

  // Handle both string and array cases
  const values = Array.isArray(connection) ? connection : [connection];

  for (const value of values) {
    if (typeof value === "string") {
      // Split by comma and trim each header name
      const headers = value.split(",").map((h) => h.trim().toLowerCase());
      for (const h of headers) {
        if (h) additionalHeaders.add(h);
      }
    }
  }

  return additionalHeaders;
}

/**
 * Build forwarded request headers with proper filtering
 * Removes hop-by-hop headers and security-sensitive headers
 * Recalculates content-length if body was rewritten
 */
function buildForwardHeaders(
  reqHeaders: IncomingMessage["headers"],
  target: Route,
  forwardBody: Buffer,
  bodyWasRewritten: boolean
): Record<string, string | string[]> {
  const forwardHeaders: Record<string, string | string[]> = {};

  // Get additional hop-by-hop headers from Connection header
  const connectionHeaders = parseConnectionHeader(reqHeaders["connection"]);

  for (const [key, value] of Object.entries(reqHeaders)) {
    const keyLower = key.toLowerCase();

    // Skip hop-by-hop headers (standard ones)
    if (HOP_BY_HOP_HEADERS.has(keyLower)) {
      continue;
    }

    // Skip headers specified in Connection header
    if (connectionHeaders.has(keyLower)) {
      continue;
    }

    // Skip security headers that could spoof origin
    if (SECURITY_HEADERS_TO_REMOVE.has(keyLower)) {
      continue;
    }

    // Skip host header (will be set by upstream URL)
    if (keyLower === "host") {
      continue;
    }

    // Recalculate content-length if body was rewritten
    if (keyLower === "content-length" && bodyWasRewritten) {
      forwardHeaders[key] = String(Buffer.byteLength(forwardBody));
      continue;
    }

    if (value !== undefined) {
      forwardHeaders[key] = value;
    }
  }

  // Override accept-encoding to disable compression
  forwardHeaders["accept-encoding"] = "identity";

  // Set content-length if body was rewritten and original didn't have it
  if (bodyWasRewritten && !forwardHeaders["content-length"]) {
    forwardHeaders["content-length"] = String(Buffer.byteLength(forwardBody));
  }

  // Replace authorization for z.ai
  // Always delete authorization when routing to z.ai to prevent OAuth token leakage
  if (target.name === "zai") {
    delete forwardHeaders["authorization"];
    if (target.apiKey) {
      forwardHeaders["x-api-key"] = target.apiKey;
    }
  }

  return forwardHeaders;
}

/**
 * Build response headers, removing hop-by-hop headers
 * When transforming, transfer-encoding and content-encoding are removed
 * since we're returning a transformed (uncompressed) response
 */
function buildResponseHeaders(
  proxyHeaders: IncomingMessage["headers"],
  isTransforming: boolean
): Record<string, string | string[]> {
  const resHeaders: Record<string, string | string[]> = {};

  // Get additional hop-by-hop headers from Connection header
  const connectionHeaders = parseConnectionHeader(proxyHeaders["connection"]);

  for (const [key, value] of Object.entries(proxyHeaders)) {
    const keyLower = key.toLowerCase();

    // Skip hop-by-hop headers (standard ones)
    if (HOP_BY_HOP_HEADERS.has(keyLower)) {
      continue;
    }

    // Skip headers specified in Connection header
    if (connectionHeaders.has(keyLower)) {
      continue;
    }

    // When transforming, remove transfer-encoding and content-encoding
    // since we're returning a new (uncompressed) response
    if (isTransforming) {
      if (keyLower === "transfer-encoding" || keyLower === "content-encoding") {
        continue;
      }
    }

    if (value !== undefined) {
      resHeaders[key] = value;
    }
  }

  return resHeaders;
}

/** Export for standalone usage */
export async function startProxy(config: Config): Promise<Server> {
  return createProxyServer(config);
}

// Start proxy if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  loadConfig()
    .then((config) => createProxyServer(config))
    .catch((err) => {
      console.error("Failed to start proxy:", err);
      process.exit(1);
    });
}
