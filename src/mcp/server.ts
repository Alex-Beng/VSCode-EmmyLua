import * as crypto from 'crypto';
import * as http from 'http';
import * as vscode from 'vscode';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { registerTools } from './tools';
import { SessionManager } from './sessionManager';
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8827;

let mcpServer: any;
let httpServer: any;
let sessionManager: SessionManager | undefined;
let transport: StreamableHTTPServerTransport | undefined;
const sseTransports = new Map<string, SSEServerTransport>();

function createMcpServer(): any {
    const server = new Server(
        { name: 'emmylua-mcp', version: '0.1.0' },
        { capabilities: { tools: {} } },
    );
    registerTools(server, sessionManager!);
    return server;
}
export const mcpOutput = vscode.window.createOutputChannel('EmmyLua MCP');

function log(msg: string): void {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    mcpOutput.appendLine(line);
    console.log(line);
}

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

function tryListen(host: string, startPort: number, maxRetries: number): Promise<{ server: http.Server; port: number }> {
    return new Promise((resolve, reject) => {
        const attempt = (i: number) => {
            if (i >= maxRetries) {
                reject(new Error(`All ports ${startPort}-${startPort + maxRetries - 1} in use`));
                return;
            }
            const p = startPort + i;
            const s = http.createServer(async (req, res) => {
                corsWrap(res);
                if (req.method === 'OPTIONS') {
                    res.writeHead(204);
                    res.end();
                    return;
                }
                const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
                log(`Request: ${req.method} ${url.pathname}`);
                if (url.pathname === '/mcp' && transport) {
                    try {
                        await transport.handleRequest(req, res);
                        log(`Streamable HTTP handled: ${req.method} ${url.pathname}`);
                    } catch (e: any) {
                        log(`Streamable HTTP error: ${e.message}`);
                        if (!res.headersSent) {
                            try { res.writeHead(400).end(e.message); } catch {}
                        }
                    }
                } else if (url.pathname === '/sse') {
                    try {
                        const sseTransport = new SSEServerTransport('/messages', res);
                        const sessionId = sseTransport.sessionId;
                        log(`SSE client connected: sessionId=${sessionId}`);
                        sseTransports.set(sessionId, sseTransport);
                        res.on('close', () => {
                            log(`SSE client disconnected: sessionId=${sessionId}`);
                            sseTransports.delete(sessionId);
                        });
                        const sseServer = createMcpServer();
                        await sseServer.connect(sseTransport);
                    } catch (e: any) {
                        log(`SSE connection error: ${e.message}`);
                        if (!res.headersSent) {
                            try { res.writeHead(500).end(e.message); } catch {}
                        }
                    }
                } else if (url.pathname === '/messages' && req.method === 'POST') {
                    const sessionId = url.searchParams.get('sessionId');
                    log(`POST /messages: sessionId=${sessionId}`);
                    if (!sessionId) {
                        log(`POST /messages: missing sessionId parameter`);
                        res.writeHead(400).end('Missing sessionId parameter');
                        return;
                    }
                    const sseTransport = sseTransports.get(sessionId);
                    if (!sseTransport) {
                        log(`POST /messages: session not found, sessionId=${sessionId}`);
                        res.writeHead(404).end('Session not found');
                        return;
                    }
                    try {
                        await sseTransport.handlePostMessage(req, res);
                    } catch (e: any) {
                        log(`POST /messages error: ${e.message}`);
                        if (!res.headersSent) {
                            try { res.writeHead(500).end(e.message); } catch {}
                        }
                    }
                } else {
                    log(`No route: ${req.method} ${url.pathname}`);
                    res.writeHead(404);
                    res.end();
                }
            });
            s.once('error', (e: any) => {
                s.close();
                if (e.code === 'EADDRINUSE') {
                    log(`Port ${p} in use, retrying ${p + 1}...`);
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

    sessionManager = new SessionManager();

    const mcpServerInstance = createMcpServer();
    transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
    });
    await mcpServerInstance.connect(transport);
    mcpServer = mcpServerInstance;

    try {
        const { server: httpSrv, port: actualPort } = await tryListen(host, port, 10);
        httpServer = httpSrv;
        log(`MCP server started at http://${host}:${actualPort}/mcp (Streamable HTTP) and /sse (SSE)`);
    } catch (e: any) {
        log(`Failed to start: ${e.message}`);
    }
}

export function stopMcpServer(): void {
    log(`Stopping MCP server (${sseTransports.size} SSE connections active)`);
    sessionManager?.dispose();
    for (const [, st] of sseTransports) {
        st.close().catch(() => {});
    }
    sseTransports.clear();
    if (mcpServer) {
        mcpServer.close().catch(() => {});
    }
    if (transport) {
        transport.close().catch(() => {});
    }
    if (httpServer) {
        httpServer.close();
    }
    mcpServer = undefined;
    httpServer = undefined;
    sessionManager = undefined;
    transport = undefined;
}
