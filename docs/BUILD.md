# Build

This document describes how to build and package the VSCode-EmmyLua extension locally.

## Prerequisites

- Node.js 20.x
- [yarn](https://yarnpkg.com/) (v1.x) — the project uses `yarn.lock` and CI runs on Yarn

## Quick Start

```bash
# 1. Install dependencies
yarn install

# 2. Compile TypeScript
yarn run compile

# 3. Download debugger & language server binaries
#    (Windows x64 example)
node ./build/prepare.js emmylua_ls-win32-x64.zip

# 4. Package into VSIX
yarn vsce package -o VSCode-EmmyLua-win32-x64.vsix --target win32-x64
```

> If `yarn` prompts about `package-lock.json`, remove it (only `yarn.lock` should be used):
> ```bash
> rm package-lock.json
> ```

## Build Steps Detail

### 1. Install Dependencies

```bash
yarn install
```

This installs both runtime (`dependencies`) and build-time (`devDependencies`) packages.

> **Note:** The build script (`build/prepare.js`) requires `decompress` and `decompress-targz`. These are declared in `devDependencies` and installed automatically by `yarn install`.

### 2. Compile TypeScript

```bash
yarn run compile
```

This runs `tsc -p ./`, compiling `src/` to `out/`. The output is plain CommonJS JavaScript with source maps.

To watch for changes during development:

```bash
yarn run watch
```

### 3. Download Binaries (prepare.js)

```bash
node ./build/prepare.js <platform-file>
```

> **One-time only:** Binaries are downloaded to `debugger/emmy/` and `server/`. Once extracted, you do **not** need to re-run this unless:
> - The version in `build/config.json` changes
> - `debugger/` or `server/` directories are deleted
> - You're setting up from a fresh clone

This downloads two sets of pre-built binaries from GitHub Releases and extracts them:

| Component | Version | Source |
|---|---|---|
| EmmyLuaDebugger | 1.9.2 | [EmmyLuaDebugger](https://github.com/EmmyLua/EmmyLuaDebugger) |
| emmylua-analyzer-rust | 0.23.2 | [emmylua-analyzer-rust](https://github.com/CppCXY/emmylua-analyzer-rust) |

**EmmyLuaDebugger** — All platform variants are always downloaded and extracted to `debugger/emmy/`:

- `linux-x64.zip` → `debugger/emmy/linux/`
- `darwin-x64.zip` → `debugger/emmy/mac/x64/`
- `darwin-arm64.zip` → `debugger/emmy/mac/arm64/`
- `win32-x86.zip` → `debugger/emmy/windows/x86/`
- `win32-x64.zip` → `debugger/emmy/windows/x64/`

**Language Server** — Only the target platform variant is downloaded and extracted to `server/`.

#### Platform File Mapping

| VS Code Target | Language Server File |
|---|---|
| `win32-x64` | `emmylua_ls-win32-x64.zip` |
| `win32-arm64` | `emmylua_ls-win32-arm64.zip` |
| `linux-x64` | `emmylua_ls-linux-x64-glibc.2.17.tar.gz` |
| `linux-arm64` | `emmylua_ls-linux-aarch64-glibc.2.17.tar.gz` |
| `darwin-x64` | `emmylua_ls-darwin-x64.tar.gz` |
| `darwin-arm64` | `emmylua_ls-darwin-arm64.tar.gz` |

### 4. Package VSIX

```bash
yarn vsce package -o VSCode-EmmyLua-<target>.vsix --target <target>
```

`--target` specifies the platform the extension will run on. The `.vscodeignore` file controls which files are excluded from the VSIX (e.g., `src/`, `build/`, `out/**/*.map` are excluded).

> **Note:** If a `LICENSE` file is missing, `vsce` will show a warning and prompt for confirmation. In CI / non-interactive mode, the prompt is automatically accepted. To suppress the warning, add a `LICENSE` file to the project root.

## Development Workflow

During development, packaging is unnecessary. Use the VS Code launch configuration instead:

1. Press **F5** (or run the `Extension` launch config in `.vscode/launch.json`)
2. This compiles TypeScript (via `preLaunchTask: "npm: watch"`) and opens a new Extension Development Host window
3. Modify TypeScript source → recompile → reload the window

### Switching package managers in launch.json

The workspace `launch.json` specifies `preLaunchTask: "npm: watch"`. If you prefer `yarn`, you can change it to:

```json
"preLaunchTask": "yarn: watch"
```

Or simply ensure `yarn run watch` is running in the background.

### EMMY_DEV Mode

When `EMMY_DEV=true` is set (as in `.vscode/launch.json`), the extension:

- Connects to the Language Server via TCP socket (default port 5007) instead of spawning a subprocess — requires the language server to be started externally for IDE features to work
- Registers `InlineDebugAdapterFactory` so debug adapters run in-process, allowing you to set breakpoints in debug adapter code (`src/debugger/`)

> **Tip:** If you only want inline debug adapters without affecting Language Server mode, set `EMMY_DEV=false` in `launch.json` instead.

## Notable Fixes

### `download` package removed

The legacy `download` package (`download@3.3.0`) was removed because it depends on `natives`, which is incompatible with Node.js 17+ (`primordials is not defined`). The `build/util.js` now uses Node.js native `fetch` (available in Node 18+) and `stream/promises.pipeline` for downloading files.

## CI Reference

The CI pipeline is defined in `.github/workflows/build.yml`. It runs on `ubuntu-latest` and:

1. Checks out the repository
2. Sets up Node.js 20.x
3. Runs `yarn install`
4. Runs `node ./build/prepare.js <platform-file>`
5. Runs `npx vsce package` for each platform in the build matrix (win32-x64, win32-arm64, linux-x64, linux-arm64, darwin-x64, darwin-arm64)
6. On tagged releases, publishes to VS Code Marketplace via `npx vsce publish`

The local build steps are identical to the CI steps.
