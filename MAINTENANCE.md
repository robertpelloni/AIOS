# Maintenance Guide

This document is for maintainers of the Super AI Plugin.

## 🔍 Debugging

### Core Service
*   **Logs:** Logs are written to `logs/traffic.log` (JSON format) and printed to stdout.
*   **Inspector:** Access `http://localhost:3000/inspector` to see real-time MCP traffic.
*   **Event Bus:** The Core uses `HookManager` to dispatch events. Check `packages/core/src/server.ts` for event wiring.

### Browser Extension
*   Open `chrome://extensions` -> **Super AI Plugin** -> **Inspect views: background page**.
*   Console logs show Socket.io connection status.

## 📦 Release Process

1.  **Version Bump:**
    Run the sync script to update all `package.json` files:
    ```bash
    npx ts-node packages/core/scripts/sync_version.ts
    ```
    (Ensure `VERSION.md` is updated first).

2.  **Build:**
    ```bash
    pnpm run build
    ```

3.  **Docker Release:**
    ```bash
    docker build -t super-ai-hub:latest .
    # docker push ...
    ```

## ⚠️ Common Issues

*   **Port 3000 in use:** The Core Service defaults to port 3000. Set `PORT=3001` env var to override.
*   **MCP Connection Failed:** Check if `mcp-servers/` directory has `npm install` run inside specific server folders if they aren't using the root `node_modules`.
*   **Memory Persistence:** If `vectors.json` grows too large, consider migrating `VectorStore` to a real database (Postgres/pgvector).
