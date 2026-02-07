/**
 * HTTP Proxy Server for Claude Code
 * Routes requests to Anthropic API or z.ai based on model name
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import type { Config } from "../config/types.js";
import type { Route } from "./types.js";
import { selectRoute, parseRequestBody } from "./router.js";
import { loadConfig } from "../config/loader.js";

/** Create and start the proxy server */
export function createProxyServer(config: Config): Server {
  const server = createServer(async (req, res) => {
    await handleRequest(req, res, config);
  });

  const { port, host } = config.proxy;
  server.listen(port, host, () => {
    console.log(`Claude Router Proxy on :${port}`);
    console.log(`  anthropic -> ${config.upstream.anthropic.url}`);
    console.log(`  glm-*    -> ${config.upstream.zai.url}`);
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

  try {
    // Collect request body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks);

    // Determine route based on model
    let target: Route;
    let model = "unknown";
    const parsed = parseRequestBody(body);
    if (parsed) {
      model = parsed.model || "no-model";
    }
    target = selectRoute(parsed?.model, config);

    // Build upstream URL
    const baseUrl = new URL(target.url);
    const basePath = baseUrl.pathname.replace(/\/$/, "");
    const upstreamUrl = new URL(basePath + req.url, baseUrl.origin);
    const isHttps = upstreamUrl.protocol === "https:";
    const doRequest = isHttps ? httpsRequest : httpRequest;

    console.log(`[${reqId}] ${req.method} ${req.url} model=${model} -> ${target.name}`);

    // Prepare headers
    const forwardHeaders: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (key === "host" || key === "connection") continue;
      if (value !== undefined) {
        forwardHeaders[key] = value;
      }
    }
    forwardHeaders["accept-encoding"] = "identity";
    forwardHeaders["content-length"] = Buffer.byteLength(body);

    // Replace authorization for z.ai
    if (target.name === "zai") {
      delete forwardHeaders["authorization"];
      forwardHeaders["x-api-key"] = target.apiKey;
    }

    // Forward request
    const proxyReq = doRequest(
      upstreamUrl,
      { method: req.method, headers: forwardHeaders },
      (proxyRes) => {
        console.log(`[${reqId}] <- ${proxyRes.statusCode}`);

        const resHeaders: Record<string, string | string[]> = {};
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (key === "connection" || key === "content-encoding") continue;
          if (value !== undefined) {
            resHeaders[key] = value;
          }
        }
        res.writeHead(proxyRes.statusCode || 200, resHeaders);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on("error", (err) => {
      console.error(`[${reqId}] ERROR: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: "proxy_error", message: err.message }));
    });

    proxyReq.write(body);
    proxyReq.end();
  } catch (err) {
    const error = err as Error;
    console.error(`[${reqId}] ERROR: ${error.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: "proxy_error", message: error.message }));
  }
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
