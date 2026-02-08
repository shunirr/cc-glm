# cc-glm

Claude Code proxy for routing requests between Anthropic API and z.ai GLM.

## Features

- **Configurable model routing**: Route requests to different upstreams based on model name patterns with glob matching
- **Model name rewriting**: Transparently rewrite model names (e.g., `claude-sonnet-*` → `GLM-4.7`)
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
cc-glm -c
cc-glm -p "PROMPT"
```

The proxy automatically:

1. Starts if not already running (singleton)
2. Sets `ANTHROPIC_BASE_URL` to route requests through the proxy
3. Routes requests based on model name matching rules
4. Stops when all Claude Code sessions have exited (after a grace period)

## Configuration

Create `~/.config/cc-glm/config.yml`:

```yaml
# Claude Code CLI command path (empty = auto-detect from PATH)
claude:
  path: ""

proxy:
  port: 8787
  host: "127.0.0.1"

upstream:
  # Anthropic API (OAuth, forwards authorization header as-is)
  anthropic:
    url: "https://api.anthropic.com"

  # z.ai GLM API
  zai:
    url: "https://api.z.ai/api/anthropic"
    apiKey: "YOUR_API_KEY" # Or falls back to ZAI_API_KEY env var

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
      model: "GLM-4.7"

    - match: "claude-haiku-*"
      upstream: zai
      model: "GLM-4.7"

    - match: "glm-*"
      upstream: zai

  default: anthropic
```

### Configuration Options

#### `claude.path`
Path to the Claude Code CLI executable. If empty or not specified, `cc-glm` will auto-detect the command from your PATH using `which` (Unix/macOS) or `where` (Windows).

```yaml
claude:
  path: "/usr/local/bin/claude"  # Custom path
  # or
  path: ""  # Auto-detect (default)
```

Without a config file, all requests are routed to Anthropic API (OAuth).

### Environment Variables

- `ZAI_API_KEY` — z.ai API key (used when config `apiKey` is empty)
- `ANTHROPIC_BASE_URL` — Automatically set by cc-glm to point to the proxy

## Model Routing

Routing rules use glob patterns (`*` wildcard) and are evaluated top-to-bottom. The first matching rule wins. Each rule can optionally rewrite the model name sent to the upstream.

| Rule Pattern | Upstream | Model Sent |
|---|---|---|
| `claude-sonnet-*` | z.ai | `GLM-4.7` |
| `claude-haiku-*` | z.ai | `GLM-4.7` |
| `glm-*` | z.ai | (original) |
| (no match) | Anthropic | (original) |

## How It Works

1. `cc-glm` starts a local HTTP proxy at `127.0.0.1:8787` (singleton via atomic lock directory)
2. Sets `ANTHROPIC_BASE_URL` so Claude Code sends API requests through the proxy
3. The proxy extracts the model name from each request body
4. Routing rules determine the upstream (Anthropic or z.ai) and optional model rewrite
5. Auth headers are adjusted per upstream:
   - **Anthropic**: forwards the original OAuth `authorization` header
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
