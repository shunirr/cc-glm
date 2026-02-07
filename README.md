# cc-glm

Claude Code proxy for switching between Anthropic API and z.ai GLM.

## Features

- **Model-based routing**: Automatically routes `glm-*` models to z.ai, others to Anthropic API
- **Singleton proxy**: One proxy instance serves multiple Claude Code sessions
- **Lifecycle management**: Automatically starts/stops proxy with Claude Code
- **YAML configuration**: Flexible config file with environment variable support
- **Zero config drop-in**: Works with existing `ANTHROPIC_API_KEY` and `ZAI_API_KEY` env vars

## Installation

```bash
npm install -g cc-glm
```

Or use with npx:

```bash
npx cc-glm
```

## Configuration

Create a configuration file at `~/.config/cc-glm/config.yml`:

```yaml
proxy:
  port: 8787
  host: "127.0.0.1"

upstream:
  anthropic:
    url: "https://api.anthropic.com"
    apiKey: ""  # Optional, uses ANTHROPIC_API_KEY env var

  zai:
    url: "https://api.z.ai/api/anthropic"
    apiKey: ""  # Optional, uses ZAI_API_KEY env var

lifecycle:
  stopGraceSeconds: 8
  startWaitSeconds: 8
  stateDir: "${TMPDIR}/claude-code-proxy"

logging:
  level: "info"
```

### Environment Variables

You can also use environment variables instead of a config file:

- `ANTHROPIC_API_KEY`: Anthropic API key
- `ZAI_API_KEY`: z.ai API key
- `ANTHROPIC_BASE_URL`: Automatically set by cc-glm

## Usage

Replace `claude` command with `cc-glm`:

```bash
# Start Claude Code with proxy
cc-glm

# Pass arguments to Claude
cc-glm --help
cc-glm ./my-project
```

The proxy will:
1. Start automatically if not running
2. Set `ANTHROPIC_BASE_URL` to route requests through the proxy
3. Route `glm-*` models to z.ai, other models to Anthropic
4. Stop automatically when all Claude Code sessions exit

## Model Routing

| Model Pattern | Destination |
|--------------|-------------|
| `glm-*` | z.ai |
| `claude-*`, others | Anthropic API |

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev

# Run tests
npm test
```

## How It Works

1. `cc-glm` starts a local HTTP proxy (default: `127.0.0.1:8787`)
2. Sets `ANTHROPIC_BASE_URL` to point to the proxy
3. When Claude Code makes API requests, the proxy inspects the model name
4. `glm-*` models are routed to z.ai, others to Anthropic
5. The proxy stays running until all Claude Code sessions exit

## License

MIT
