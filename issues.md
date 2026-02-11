# Known Issues

## Proxy process remains after all cc-glm instances exit

When all cc-glm CLI instances are terminated, the proxy process continues running.

**Expected:** Proxy process should terminate when no cc-glm CLI instances are active.

**Impact:** Orphaned proxy processes consume resources and may hold the port, requiring manual cleanup (`kill`).

**Related code:**
- `src/lifecycle/singleton.ts` — Lock-directory based singleton proxy management
- `src/lifecycle/tracker.ts` — Claude process detection via pgrep

**Investigation needed:**
- Review tracker logic for detecting active Claude processes
- Check if the shutdown hook in singleton properly triggers when all clients disconnect
- Verify PID file cleanup on unexpected termination
