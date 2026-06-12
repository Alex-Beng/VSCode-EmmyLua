# EmmyLua for VSCode

## Build & Verify
- `npm run compile` — tsc 编译（strict 模式，`noUnusedLocals` 开启）
- `npm run build:mcp` — esbuild 打包 MCP server 为独立 bundle（`out/mcp/server.js`）
- 无单元测试（`npm test` 需要 VSCode 测试基础设施，本地不常用）
- 发布：`node build/release.js` → `npx vsce package`

## Architecture
- **入口**: `src/extension.ts` — 激活事件 `onDebug`
- **语言服务**: 外部 Rust 二进制 `emmylua_ls`（`server/`），通过 LSP 通信；调试模式可连 socket（`emmylua.ls.debugPort`）
- **调试器** (`src/debugger/`):
  - `emmylua_new` — 主要调试器，IDE 连 debugger（`ideConnectDebugger: true`）
  - `emmylua_attach` — 按 PID 附加进程
  - `emmylua_launch` — 直接启动 Lua 程序
- **MCP 服务器** (`src/mcp/`): 同时支持 Streamable HTTP（`POST /mcp`）和 SSE（`GET /sse` + `POST /messages`），端口 8827 起自动递增

## MCP Key Points
- 手动启动：命令面板 `EmmyLua: Start MCP Server`，端口看 Output → EmmyLua MCP
- 本仓库自身 `opencode.json`：`type: remote`，URL `http://127.0.0.1:8827/sse`
- MCP 工具定义在 `src/mcp/tools.ts`，断点/会话跟踪在 `src/mcp/sessionManager.ts`
- 端口冲突自动 +1，实际端口看 Output 面板

## Conventions
- 语言服务二进制按平台分开（`server/` + CI 6 平台构建），改 LSP 侧需去 [emmylua-analyzer-rust](https://github.com/CppCXY/emmylua-analyzer-rust)
- `noUnusedLocals: true` — 编译会报未使用局部变量
- VS Code 引擎 `^1.89.0`，`@types/vscode` 固定 1.89.0
- 调试器 native 库在 `debugger/emmy/`（windows x64/x86 / linux / mac x64/arm64）
- i18n 字符串在 `package.nls.json` / `package.nls.zh-cn.json`
