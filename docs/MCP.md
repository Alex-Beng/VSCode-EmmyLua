# MCP for EmmyLua Debugger

基于 VSCode 插件，暴露出 EmmyLua Debugger 的调试功能，提供人类和 AI 可协作的调试工具，即提供 AI 操控 VSCode 进行调试。

## 架构

```
MCP Client (AI / 人类)
    ↕ HTTP (Streamable HTTP Transport)
    http://127.0.0.1:8827/mcp
Express Server (插件进程内)
    ↕ vscode.debug.* API  /  session.customRequest
VS Code Debugger
    ↕ DAP (Debug Adapter Protocol)
Debug Adapter (独立进程 / 内联)
    ↕ TCP
Lua 运行时 (emmy_core.dll / emmy_core.so)
```

MCP Server 以 Express HTTP 服务形式跑在 Extension Host 进程内。每个 MCP Tool 封装一次对 `vscode.debug.*` 或 `session.customRequest()` 的调用——等价于模拟人类的键盘/鼠标操作，**不重复实现任何调试逻辑**。

## 依赖

```json
"dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^3.25"
}
```

`zod@^3.25` 必须显式安装，因为项目 TypeScript 版本（4.x）不能解析 MCP SDK 自带 zod v4 的类型声明。`zod@3.x` 的 `v4/` 兼容存根已在 `postinstall` 中被清理。

## 目录结构

```
src/mcp/
├── server.ts               -- MCP Server 启动入口 (use Server, not McpServer)
├── sessionManager.ts       -- 调试会话状态管理
├── breakpointManager.ts    -- 断点状态管理 (待实现)
└── tools.ts                -- 所有 Tool 定义 (使用 Server API 而非 McpServer API)
```

## 当前状态

| 文件 | 状态 | 说明 |
|---|---|---|
| `server.ts` | ✅ 已实现 | Streamable HTTP Transport (Express) |
| `sessionManager.ts` | ✅ 已实现 | 监听调试会话生命周期 |
| `tools.ts` | ✅ 已实现 | 18 个调试工具 |

## 启动方式

环境变量控制启动（已配置在 `.vscode/launch.json`）：

```json
"env": {
    "EMMY_DEV": "true",
    "EMMY_MCP": "true"
}
```

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `EMMY_MCP` | — | 设为 `true` 启动 MCP Server |
| `EMMY_MCP_HOST` | `127.0.0.1` | 监听地址 |
| `EMMY_MCP_PORT` | `8827` | 监听端口 |

代码位置：`src/extension.ts:145-148`

```typescript
if (process.env['EMMY_MCP'] === 'true') {
    const { startMcpServer } = await import('./mcp/server');
    await startMcpServer();
}
```

## 注意点

### 为什么用 `Server` API 而不是 `McpServer`

`McpServer.registerTool` 的泛型推导层级过深，而项目 TypeScript 版本较旧，导致 `TS2589: Type instantiation is excessively deep`。解决方法：

- `tools.ts` 使用底层 `Server.setRequestHandler` 手动处理 `tools/list` 和 `tools/call`
- `tools.ts` 中所有 MCP 类型相关代码用 `any` 绕过类型推导

后续升级 TypeScript 到 5.x 后可改用 `McpServer` 的 `registerTool` API。

### zod v4 类型兼容

MCP SDK 运行时 `require("zod/v4")`，而 `zod@^3.25` 内置了 v4 兼容存根（`node_modules/zod/v4/`）。删除这些存根会导致运行时崩溃（`Cannot find module 'zod/v4/index.cjs'`），所以**必须保留**。项目 TypeScript 已升级到 v5，可以正常解析 v4 的类型声明。

`sessionManager.ts` 负责维护活跃调试会话的映射，监听调试生命周期事件：

```typescript
class SessionManager {
    private sessions: Map<string, SessionInfo>;

    // vscode.debug.onDidStartDebugSession → 添加
    // vscode.debug.onDidTerminateDebugSession → 移除
}
```

## 断点管理 (待实现)

`breakpointManager.ts` 负责维护断点列表，通过 `vscode.debug.breakpoints` 存取。

## 工具列表

当前已实现 18 个工具。所有工具使用 `session.customRequest(method, args)` 或 `vscode.debug.*` 调用对应的 Debug Adapter Protocol 方法。

| MCP Tool | 对应的 DAP / VS Code API | 说明 |
|---|---|---|
| `list_supported_languages` | — | 返回 `["lua"]` |
| `get_active_sessions` | `SessionManager.getActiveSessions()` | 列出活跃调试会话 |
| `threads` | `session.customRequest('threads')` | 获取线程列表 |
| `stack_trace` | `session.customRequest('stackTrace', { threadId, startFrame?, levels? })` | 获取堆栈 |
| `scopes` | `session.customRequest('scopes', { frameId })` | 获取作用域 |
| `variables` | `session.customRequest('variables', { variablesReference, filter?, start?, count? })` | 获取变量 |
| `evaluate` | `session.customRequest('evaluate', { expression, frameId })` | 求值表达式 |
| `set_variable` | `session.customRequest('setExpression', { expression, value, frameId })` | 修改变量 |
| `set_breakpoints` | `session.customRequest('setBreakpoints', { source, breakpoints })` | 设置断点 |
| `continue` | `session.customRequest('continue', { threadId })` | 继续执行 |
| `pause` | `session.customRequest('pause', { threadId })` | 暂停执行 |
| `step_over` | `session.customRequest('next', { threadId })` | 单步跳过 |
| `step_in` | `session.customRequest('stepIn', { threadId })` | 单步进入 |
| `step_out` | `session.customRequest('stepOut', { threadId })` | 单步跳出 |
| `source` | `session.customRequest('source', { sourceReference })` | 获取源码 |
| `disconnect` | `session.customRequest('disconnect')` | 断开调试会话 |
| `launch` | `vscode.debug.startDebugging(folder, config)` | 启动新调试会话 |

所有工具通过 `src/mcp/tools.ts` 中的 `tools/call` 分发器统一管理，错误信息统一返回 `{ error: message }` JSON。

## 验证方式

MCP Server 以 HTTP 服务形式运行在 Extension Host 进程内。

### 1. 启动日志确认

F5 启动 Extension Host，打开开发者控制台（帮助 → 切换开发人员工具），看到：

```
EmmyLua MCP server started at http://127.0.0.1:8827/mcp
```

### 2. 用 MCP Inspector 连接

```bash
npx @modelcontextprotocol/inspector
```

在 Inspector 界面中，Transport Type 选择 `Streamable HTTP`，URL 填入：

```
http://127.0.0.1:8827/mcp
```

### 3. 用 curl 测试

```bash
# 列出工具
curl -X POST http://127.0.0.1:8827/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 调用工具
curl -X POST http://127.0.0.1:8827/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_supported_languages","arguments":{}}}'
```

## 实现步骤

### ✅ Step 1: 添加依赖

```bash
yarn add @modelcontextprotocol/sdk zod@^3.25
yarn add --dev typescript@^5.5
```

### ✅ Step 2: 实现 SessionManager

`src/mcp/sessionManager.ts` — 维护会话列表，提供按 sessionId 查找的方法。

### ✅ Step 3: 实现 Server

`src/mcp/server.ts` — 基于 Express + `StreamableHTTPServerTransport` 的 HTTP 服务。

### ✅ Step 4: 实现 Tools

`src/mcp/tools.ts` — 18 个调试工具，使用低层 `Server.setRequestHandler` API 避免 `TS2589`。

### ✅ Step 5: 注册到 Extension

`src/extension.ts:145-148` — 由 `EMMY_MCP=true` 环境变量控制。

### Step 6: 验证

- F5 启动 → 控制台看到 `EmmyLua MCP server started at http://127.0.0.1:8827/mcp`
- 用 MCP Inspector 或 curl 测试（见下方验证方式）

## 接口参考

接口参考 [mcp-debugger](https://github.com/debugmcp/mcp-debugger) 项目设计。
