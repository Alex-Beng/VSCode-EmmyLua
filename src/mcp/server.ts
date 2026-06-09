import * as http from 'http';
import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from './tools';
import { SessionManager } from './sessionManager';
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8827;

let mcpServer: any;
let httpServer: any;
let sessionManager: SessionManager | undefined;
let transport: any;
let sessionDisposables: vscode.Disposable[] = [];

function corsWrap(res: any): void {
    const orig = res.writeHead.bind(res);
    res.writeHead = function (this: any, status: number, ...args: any[]) {
        if (!this.hasHeader('Access-Control-Allow-Origin')) {
            this.setHeader('Access-Control-Allow-Origin', '*');
            this.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
            this.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version');
            this.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
        }
        return orig(status, ...args);
    };
}

function makeTransport(): any {
    return new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
    });
}

function createHttpServer(): http.Server {
    const s = http.createServer((req, res) => {
        corsWrap(res);
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        if (req.url !== '/mcp') {
            res.writeHead(404);
            res.end();
            return;
        }
        const handle = async () => {
            try {
                if (req.method === 'POST') {
                    const body = await new Promise<string>((resolve) => {
                        const parts: Buffer[] = [];
                        req.on('data', (c: Buffer) => parts.push(c));
                        req.on('end', () => resolve(Buffer.concat(parts as any).toString()));
                    });
                    const parsedBody = JSON.parse(body);
                    if (parsedBody.method === 'initialize' && transport?.sessionId) {
                        await mcpServer.close();
                        mcpServer._transport = null;
                        transport = makeTransport();
                        await mcpServer.connect(transport);
                    }
                    await transport.handleRequest(req, res, parsedBody);
                } else {
                    await transport.handleRequest(req, res);
                }
            } catch (e: any) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: e.message }));
            }
        };
        handle();
    });
    return s;
}

function tryListen(host: string, startPort: number, maxRetries: number): Promise<{ server: http.Server; port: number }> {
    return new Promise((resolve, reject) => {
        const attempt = (i: number) => {
            if (i >= maxRetries) {
                reject(new Error(`All ports ${startPort}-${startPort + maxRetries - 1} in use`));
                return;
            }
            const p = startPort + i;
            const s = createHttpServer();
            s.once('error', (e: any) => {
                s.close();
                if (e.code === 'EADDRINUSE') {
                    attempt(i + 1);
                } else {
                    reject(e);
                }
            });
            s.listen(p, host, () => {
                resolve({ server: s, port: p });
            });
        };
        attempt(0);
    });
}

export async function startMcpServer(): Promise<void> {
    const host = process.env['EMMY_MCP_HOST'] || DEFAULT_HOST;
    const port = parseInt(process.env['EMMY_MCP_PORT'] || String(DEFAULT_PORT), 10);

    const mcpServerInstance = new Server(
        { name: 'emmylua-mcp', version: '0.1.0' },
        { capabilities: { tools: {} } },
    );

    sessionManager = new SessionManager();
    registerTools(mcpServerInstance, sessionManager);

    transport = makeTransport();
    await mcpServerInstance.connect(transport);

    mcpServer = mcpServerInstance;

    try {
        const { server: httpSrv, port: actualPort } = await tryListen(host, port, 10);
        httpServer = httpSrv;
        console.log(`EmmyLua MCP server started at http://${host}:${actualPort}/mcp`);
    } catch (e: any) {
        console.error(`[EMMY_MCP] ${e.message}`);
    }

    sessionDisposables.push(
        vscode.debug.onDidTerminateDebugSession(() => {
            stopMcpServer();
        }),
        vscode.debug.onDidStartDebugSession(() => {
            if (!httpServer && !mcpServer) {
                startMcpServer();
            }
        }),
    );
}

export function stopMcpServer(): void {
    sessionDisposables.forEach(d => d.dispose());
    sessionDisposables = [];
    sessionManager?.dispose();
    if (mcpServer) {
        mcpServer.close();
    }
    if (httpServer) {
        httpServer.close();
    }
    mcpServer = undefined;
    httpServer = undefined;
    sessionManager = undefined;
    transport = undefined;
}
