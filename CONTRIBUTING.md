# Contributing to Super AI Plugin

We welcome contributions! This document guides you through setting up your environment and submitting changes.

## 🛠 Development Setup

1.  **Prerequisites:**
    *   Node.js v20+
    *   pnpm (`npm install -g pnpm`)
    *   Docker (optional, for testing containerized features)

2.  **Install Dependencies:**
    ```bash
    pnpm install
    ```

3.  **Start Development Server:**
    ```bash
    pnpm dev
    ```
    This starts the Core Service and the UI in watch mode.

## 📂 Project Structure

*   `packages/core`: The Hub logic (Node.js).
*   `packages/ui`: The Dashboard (React).
*   `packages/cli`: The `super-ai` command line tool.
*   `mcp-servers/`: Managed MCP servers.

## 🧪 Testing

*   **Unit Tests:** `pnpm test`
*   **Manual Verification:** Use the "Inspector" in the UI to replay tool calls.

## 📝 Coding Standards

*   Use **TypeScript** for all new logic.
*   Follow the "Manager" pattern in `packages/core/src/managers`.
*   Update `ROADMAP.md` if you implement a tracked feature.

## 🚀 Submitting a Pull Request

1.  Fork the repository.
2.  Create a feature branch (`feat/my-feature`).
3.  Commit your changes.
4.  Push and open a PR.
