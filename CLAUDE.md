# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

cc-glm is a proxy server that routes requests between Anthropic API and z.ai GLM based on model name patterns. It wraps Claude Code CLI, automatically managing proxy lifecycle with singleton semantics.

## Commands

- `npm run build` — Build with tsup (ESM output to `dist/`)
- `npm run dev` — Build in watch mode
- `npm run lint` — Type-check only (`tsc --noEmit`)
- `npm test` — Run tests in watch mode (Vitest)
- `npm run test:run` — Run tests once
- `npx vitest run test/unit/router.test.ts` — Run a single test file

## Architecture

```
src/
├── bin/cli.ts           # CLI entry: wraps Claude Code, auto-starts proxy, sets ANTHROPIC_BASE_URL
├── proxy/
│   ├── server.ts        # HTTP proxy: extracts model from request body, routes via router, rewrites auth headers
│   ├── router.ts        # Glob-pattern model matching, first-match wins, supports model name rewriting
│   ├── transform.ts     # Converts z.ai thinking block format to Anthropic-compatible format
│   └── types.ts
├── config/
│   ├── loader.ts        # YAML config loader with ${VAR:-default} env expansion
│   └── types.ts
├── lifecycle/
│   ├── singleton.ts     # Lock-directory based singleton proxy management (atomic mkdir)
│   └── tracker.ts       # Claude process detection via pgrep
└── utils/
    ├── logger.ts        # Logging with chalk
    └── process.ts       # PID file management, port readiness checks
```

**Request flow:** CLI starts singleton proxy → proxy receives API requests → router matches model name against glob rules → request forwarded to Anthropic or z.ai with appropriate auth headers → z.ai responses are transformed for compatibility.

**Auth header handling:**
- Anthropic: forwards original `authorization` header
- z.ai: removes `authorization`, adds `x-api-key` header

## Key Conventions

- **ESM-only** (`"type": "module"`): all imports use `.js` extensions even for `.ts` source files
- **TypeScript strict mode**, target ES2022, Node.js >= 18
- **Type definitions** are separated into `types.ts` files per module
- **Config precedence:** config file > environment variables (`ANTHROPIC_API_KEY`, `ZAI_API_KEY`) > defaults
- **Routing rules** use simple glob patterns (`*` only), evaluated top-to-bottom
