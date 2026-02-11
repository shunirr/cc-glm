# Known Issues

## Proxy process remains after all cc-glm instances exit

When all cc-glm CLI instances are terminated, the proxy process continues running.

**Expected:** Proxy process should terminate when no cc-glm CLI instances are active.

**Impact:** Orphaned proxy processes consume resources and may hold the port, requiring manual cleanup (`kill`).

**Root cause (identified):**

The Claude process tracker (`src/lifecycle/tracker.ts`) uses `pgrep -x claude` to detect running Claude processes. This pattern matches **any** process with "claude" in the name, including:

1. `cc-glm` CLI processes (intended)
2. `Claude Desktop App` (unintended - causes proxy to stay alive)
3. Other Claude-related processes

**Scenario:**
1. User opens Claude Desktop App → `hasClaudeProcess()` returns `true`
2. cc-glm starts proxy, sees Claude is "running"
3. User closes cc-glm but leaves Claude Desktop open
4. `stopIfNoClaude()` sees Claude Desktop still running, doesn't stop proxy
5. Result: Orphaned proxy process continues running

**Related code:**
- `src/lifecycle/singleton.ts` — Lock-directory based singleton proxy management
- `src/lifecycle/tracker.ts` — Claude process detection via pgrep

**Proposed solutions:**

1. **Track cc-glm PIDs explicitly** — When starting the proxy, record parent cc-glm PID and only consider that specific process as "active"
2. **More specific pgrep pattern** — Use `cc-glm` or full path matching instead of generic `claude`
3. **Desktop app exclusion** — Filter out `Claude` (capital C) or known Desktop App bundle IDs
4. **Count-based tracking** — Track cc-glm instance count incrementally, decrement on exit
