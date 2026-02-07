/**
 * Configuration types for cc-glm
 */

/** Proxy server configuration */
export interface ProxyConfig {
  port: number;
  host: string;
}

/** Upstream API configuration */
export interface UpstreamConfig {
  anthropic: AnthropicUpstream;
  zai: ZaiUpstream;
}

/**
 * Anthropic upstream configuration (OAuth-based)
 * Note: apiKey is not used for Anthropic as it uses OAuth authorization header forwarding
 */
export interface AnthropicUpstream {
  url: string;
}

/**
 * z.ai upstream configuration (API key-based)
 * The apiKey is used to set the x-api-key header for z.ai requests
 */
export interface ZaiUpstream {
  url: string;
  apiKey?: string;
}

/** Lifecycle management configuration */
export interface LifecycleConfig {
  /** Seconds to wait after Claude exits before stopping proxy */
  stopGraceSeconds: number;
  /** Maximum seconds to wait for proxy startup */
  startWaitSeconds: number;
  /** Directory for PID files and logs */
  stateDir: string;
}

/** Logging configuration */
export interface LoggingConfig {
  level: "debug" | "info" | "warn" | "error";
}

/** Single routing rule */
export interface RoutingRule {
  match: string;
  upstream: "anthropic" | "zai";
  model?: string;
}

/** Routing configuration */
export interface RoutingConfig {
  rules: RoutingRule[];
  default: "anthropic" | "zai";
}

/** Signature store configuration */
export interface SignatureStoreConfig {
  /** Maximum number of signatures to store in LRU cache */
  maxSize?: number;
}

/** Complete configuration structure */
export interface Config {
  proxy: ProxyConfig;
  upstream: UpstreamConfig;
  lifecycle: LifecycleConfig;
  logging: LoggingConfig;
  routing: RoutingConfig;
  signatureStore?: SignatureStoreConfig;
}

/** Raw parsed YAML structure (before environment variable expansion) */
export interface RawConfig {
  proxy?: Partial<ProxyConfig>;
  upstream?: Partial<UpstreamConfig>;
  lifecycle?: Partial<LifecycleConfig>;
  logging?: Partial<LoggingConfig>;
  routing?: Partial<RoutingConfig>;
  signature_store?: Partial<SignatureStoreConfig>;
}
