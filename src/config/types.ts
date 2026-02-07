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
  anthropic: UpstreamEndpoint;
  zai: UpstreamEndpoint;
}

/** Single upstream endpoint configuration */
export interface UpstreamEndpoint {
  url: string;
  apiKey: string;
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

/** Complete configuration structure */
export interface Config {
  proxy: ProxyConfig;
  upstream: UpstreamConfig;
  lifecycle: LifecycleConfig;
  logging: LoggingConfig;
}

/** Raw parsed YAML structure (before environment variable expansion) */
export interface RawConfig {
  proxy?: Partial<ProxyConfig>;
  upstream?: Partial<UpstreamConfig>;
  lifecycle?: Partial<LifecycleConfig>;
  logging?: Partial<LoggingConfig>;
}
