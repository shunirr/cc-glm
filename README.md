# cc-glm

Claude Code proxy for routing requests between Anthropic API and z.ai GLM.

## Features

- **Configurable model routing**: Route requests to different upstreams based on model name patterns with glob matching
- **Model name rewriting**: Transparently rewrite model names (e.g., `claude-sonnet-*` → `glm-4-plus`)
- **Thinking block transformation**: Convert z.ai thinking block format to Anthropic-compatible format
- **Singleton proxy**: One proxy instance shared across multiple Claude Code sessions
- **Lifecycle management**: Proxy starts/stops automatically with Claude Code
- **YAML configuration**: Config file with `${VAR:-default}` environment variable expansion

## Installation

```bash
npm install -g cc-glm
```

Or use with npx:

```bash
npx cc-glm
```

## Usage

Use `cc-glm` as a drop-in replacement for `claude`:

```bash
# Start Claude Code through the proxy
cc-glm

# Pass arguments to Claude Code
cc-glm --help
cc-glm ./my-project
```

The proxy automatically:

1. Starts if not already running (singleton)
2. Sets `ANTHROPIC_BASE_URL` to route requests through the proxy
3. Routes requests based on model name matching rules
4. Stops when all Claude Code sessions have exited (after a grace period)

## Configuration

Create `~/.config/cc-glm/config.yml`:

```yaml
proxy:
  port: 8787
  host: "127.0.0.1"

upstream:
  anthropic:
    url: "https://api.anthropic.com"
    apiKey: ""  # Falls back to ANTHROPIC_API_KEY env var

  zai:
    url: "https://api.z.ai/api/anthropic"
    apiKey: ""  # Falls back to ZAI_API_KEY env var

lifecycle:
  stopGraceSeconds: 8
  startWaitSeconds: 8
  stateDir: "${TMPDIR}/claude-code-proxy"

logging:
  level: "info"  # debug, info, warn, error

# Rules are evaluated top-to-bottom, first match wins
routing:
  rules:
    - match: "claude-sonnet-*"
      upstream: zai
      model: "glm-4-plus"

    - match: "claude-haiku-*"
      upstream: zai
      model: "glm-4-flash"

    - match: "glm-*"
      upstream: zai

  default: anthropic
```

Without a config file, all requests are routed to Anthropic API using the `ANTHROPIC_API_KEY` environment variable.

### Environment Variables

- `ANTHROPIC_API_KEY` — Anthropic API key (used when config `apiKey` is empty)
- `ZAI_API_KEY` — z.ai API key (used when config `apiKey` is empty)
- `ANTHROPIC_BASE_URL` — Automatically set by cc-glm to point to the proxy

## Model Routing

Routing rules use glob patterns (`*` wildcard) and are evaluated top-to-bottom. The first matching rule wins. Each rule can optionally rewrite the model name sent to the upstream.

| Rule Pattern | Upstream | Model Sent |
|---|---|---|
| `claude-sonnet-*` | z.ai | `glm-4-plus` |
| `claude-haiku-*` | z.ai | `glm-4-flash` |
| `glm-*` | z.ai | (original) |
| (no match) | Anthropic | (original) |

## How It Works

1. `cc-glm` starts a local HTTP proxy at `127.0.0.1:8787` (singleton via atomic lock directory)
2. Sets `ANTHROPIC_BASE_URL` so Claude Code sends API requests through the proxy
3. The proxy extracts the model name from each request body
4. Routing rules determine the upstream (Anthropic or z.ai) and optional model rewrite
5. Auth headers are adjusted per upstream:
   - **Anthropic**: forwards the original `authorization` header
   - **z.ai**: replaces `authorization` with `x-api-key`
6. z.ai responses are transformed to ensure Anthropic-compatible thinking block format
7. After Claude Code exits, the proxy waits a grace period (default 8s) and stops if no other sessions remain

## Development

```bash
npm install
npm run build       # Build with tsup
npm run dev         # Build in watch mode
npm run lint        # Type check (tsc --noEmit)
npm test            # Run tests (watch mode)
npm run test:run    # Run tests once
```

## License

MIT
