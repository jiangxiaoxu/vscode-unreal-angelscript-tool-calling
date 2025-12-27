/**
 * MCP Server for Angelscript API Search (HTTP Mode)
 * 
 * This module provides an MCP server that is started by the VS Code extension
 * and shares the LanguageClient with the extension. It exposes the same
 * angelscript_searchApi tool functionality via the MCP protocol over HTTP.
 * 
 * Features:
 * - Single-instance mode: Only one MCP server runs across multiple VS Code instances
 * - Health check endpoint: GET /health returns server status
 * - Automatic retry: If port is occupied, retries every 1 second
 * - Configurable port: Default is Unreal connection port + 100
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { LanguageClient, RequestType } from 'vscode-languageclient/node';
import * as http from 'http';
import * as vscode from 'vscode';

const GetAPISearchRequest = new RequestType<any, any[], void>('angelscript/getAPISearch');
const GetAPIDetailsRequest = new RequestType<any, string, void>('angelscript/getAPIDetails');

// Unique server identifier for this extension
const SERVER_ID = "angelscript-mcp-server-v1";

// Configuration constants
const HEALTH_CHECK_TIMEOUT_MS = 2000;
const RETRY_INTERVAL_MS = 1000;

// Tool definition matching the VS Code extension's languageModelTools schema
const ANGELSCRIPT_SEARCH_TOOL: Tool = {
    name: "angelscript_searchApi",
    description: "Search the Angelscript API database for symbols and documentation. Provide a query string and optionally limit the results or include documentation details.",
    inputSchema: {
        type: "object" as const,
        properties: {
            query: {
                type: "string",
                description: "Search query text for Angelscript API symbols."
            },
            limit: {
                type: "number",
                description: "Maximum number of results to return (1-1000).",
                default: 500,
                minimum: 1,
                maximum: 1000
            },
            includeDetails: {
                type: "boolean",
                description: "Include documentation details for top matches.",
                default: true
            }
        },
        required: ["query"]
    }
};

interface SearchParams {
    query: string;
    limit?: number;
    includeDetails?: boolean;
}

interface SearchResultItem {
    label: string;
    type?: string;
    data?: unknown;
    details?: string;
}

interface SearchPayload {
    query: string;
    total: number;
    returned: number;
    truncated: boolean;
    items: SearchResultItem[];
}

/**
 * MCP Server class that wraps the LanguageClient for API search (HTTP mode)
 */
export class AngelscriptMcpServer {
    private server: Server;
    private client: LanguageClient;
    private clientReady: Promise<void>;
    private httpServer: http.Server | null = null;
    private retryInterval: ReturnType<typeof setInterval> | null = null;
    private isRunning: boolean = false;
    private port: number = 27199; // Default: 27099 + 100
    private workspaceName: string = "";
    private activeTransports: Map<string, SSEServerTransport> = new Map();

    constructor(client: LanguageClient, clientReady: Promise<void>) {
        this.client = client;
        this.clientReady = clientReady;
        this.server = this.createServer();
        
        // Get workspace name for identification
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this.workspaceName = workspaceFolders[0].name;
        }
    }

    /**
     * Get the configured MCP server port
     */
    private getConfiguredPort(): number {
        const config = vscode.workspace.getConfiguration("UnrealAngelscript");
        const mcpPort = config.get<number>("mcpServerPort");
        if (mcpPort !== undefined && mcpPort > 0) {
            return mcpPort;
        }
        // Default: Unreal connection port + 100
        const unrealPort = config.get<number>("unrealConnectionPort") ?? 27099;
        return unrealPort + 100;
    }

    /**
     * Create and configure the MCP server
     */
    private createServer(): Server {
        const server = new Server(
            {
                name: "angelscript-mcp-server",
                version: "1.0.0",
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        // Handle list_tools request
        server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [ANGELSCRIPT_SEARCH_TOOL],
            };
        });

        // Handle call_tool request
        server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            if (name === "angelscript_searchApi") {
                const params = args as unknown as SearchParams;
                const result = await this.performApiSearch(params);
                
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: result,
                        },
                    ],
                };
            }

            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Unknown tool: ${name}`,
                    },
                ],
                isError: true,
            };
        });

        return server;
    }

    /**
     * Perform the API search using the shared LanguageClient
     */
    private async performApiSearch(params: SearchParams): Promise<string> {
        const query = typeof params.query === "string" ? params.query.trim() : "";
        
        if (!query) {
            return "No query provided. Please supply a search query.";
        }

        try {
            // Wait for client to be ready
            await this.clientReady;
            
            const limit = typeof params.limit === "number"
                ? Math.min(Math.max(Math.floor(params.limit), 1), 1000)
                : 500;
            const includeDetails = params.includeDetails !== false;

            // Use the shared LanguageClient to search
            const results = await this.client.sendRequest(GetAPISearchRequest, query);
            
            if (!results || results.length === 0) {
                return `No Angelscript API results for "${query}".`;
            }

            const items = results.slice(0, limit);
            const payload: SearchPayload = {
                query,
                total: results.length,
                returned: items.length,
                truncated: results.length > items.length,
                items: items.map((item: any) => ({
                    label: item.label,
                    type: item.type ?? undefined,
                    data: item.data ?? undefined
                }))
            };

            // Fetch details for each item if requested
            if (includeDetails) {
                // Use concurrent requests with limit
                const CONCURRENCY_LIMIT = 10;
                const allDetails: Array<{ index: number; details?: string }> = [];
                let nextIndex = 0;
                let activeCount = 0;
                const totalItems = payload.items.length;

                if (totalItems > 0) {
                    await new Promise<void>((resolveAll) => {
                        const startNext = () => {
                            // Fill up to CONCURRENCY_LIMIT active requests
                            while (nextIndex < totalItems && activeCount < CONCURRENCY_LIMIT) {
                                const currentIndex = nextIndex;
                                const item = payload.items[currentIndex];
                                const itemData = item.data;
                                nextIndex++;
                                activeCount++;

                                this.client.sendRequest(GetAPIDetailsRequest, itemData)
                                    .then((details: string) => {
                                        allDetails.push({ index: currentIndex, details });
                                    })
                                    .catch((error: any) => {
                                        console.error(`Failed to fetch details for ${item.label}:`, error);
                                        allDetails.push({ index: currentIndex, details: undefined });
                                    })
                                    .finally(() => {
                                        activeCount--;
                                        if (nextIndex >= totalItems && activeCount === 0) {
                                            resolveAll();
                                        } else {
                                            startNext();
                                        }
                                    });
                            }
                        };

                        startNext();
                    });
                }

                // Map details back to items by index
                for (const detail of allDetails) {
                    payload.items[detail.index].details = detail.details;
                }
            }

            return JSON.stringify(payload, null, 2);
        } catch (error) {
            console.error("angelscript_searchApi MCP tool failed:", error);
            return "The Angelscript API tool failed to run. Please ensure the language server is running and try again.";
        }
    }

    /**
     * Check if an MCP server is already running on the port
     */
    private async checkHealth(port: number): Promise<{ running: boolean; isOurs: boolean }> {
        return new Promise((resolve) => {
            const req = http.request(
                {
                    hostname: "localhost",
                    port: port,
                    path: "/health",
                    method: "GET",
                    timeout: HEALTH_CHECK_TIMEOUT_MS,
                },
                (res) => {
                    let data = "";
                    res.on("data", (chunk) => {
                        data += chunk;
                    });
                    res.on("end", () => {
                        try {
                            const json = JSON.parse(data);
                            const isOurs = json.serverId === SERVER_ID;
                            resolve({ running: true, isOurs });
                        } catch {
                            // Response is not our server format
                            resolve({ running: true, isOurs: false });
                        }
                    });
                }
            );
            req.on("error", () => {
                resolve({ running: false, isOurs: false });
            });
            req.on("timeout", () => {
                req.destroy();
                resolve({ running: false, isOurs: false });
            });
            req.end();
        });
    }

    /**
     * Try to start the HTTP server on the specified port
     */
    private async tryStartServer(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const httpServer = http.createServer(async (req, res) => {
                // Enable CORS for all endpoints
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
                res.setHeader("Access-Control-Allow-Headers", "Content-Type");

                if (req.method === "OPTIONS") {
                    res.writeHead(204);
                    res.end();
                    return;
                }

                // Handle health check
                if (req.method === "GET" && req.url === "/health") {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({
                        status: "ok",
                        serverId: SERVER_ID,
                        workspace: this.workspaceName,
                        port: port,
                    }));
                    return;
                }

                // Handle SSE endpoint for MCP
                if (req.method === "GET" && req.url === "/sse") {
                    console.log("New SSE connection");
                    const transport = new SSEServerTransport("/message", res);
                    
                    // Store the transport with a unique session ID
                    const sessionId = transport.sessionId;
                    this.activeTransports.set(sessionId, transport);
                    
                    // Clean up when connection closes
                    res.on("close", () => {
                        console.log(`SSE connection closed: ${sessionId}`);
                        this.activeTransports.delete(sessionId);
                    });
                    
                    await this.server.connect(transport);
                    return;
                }

                // Handle message endpoint for MCP
                if (req.method === "POST" && req.url?.startsWith("/message")) {
                    // Extract session ID from query string
                    const url = new URL(req.url, `http://localhost:${port}`);
                    const sessionId = url.searchParams.get("sessionId");
                    
                    if (!sessionId) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: "Missing sessionId parameter" }));
                        return;
                    }
                    
                    const transport = this.activeTransports.get(sessionId);
                    if (!transport) {
                        res.writeHead(404, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: "Session not found" }));
                        return;
                    }
                    
                    // Pass the request to the transport for handling
                    await transport.handlePostMessage(req, res);
                    return;
                }

                // 404 for other routes
                res.writeHead(404);
                res.end("Not Found");
            });

            httpServer.on("error", (err: NodeJS.ErrnoException) => {
                if (err.code === "EADDRINUSE") {
                    resolve(false);
                } else {
                    console.error("MCP HTTP Server error:", err);
                    resolve(false);
                }
            });

            httpServer.listen(port, "localhost", () => {
                this.httpServer = httpServer;
                this.isRunning = true;
                this.port = port;
                console.log(`Angelscript MCP Server started on http://localhost:${port}`);
                console.log(`Health check: http://localhost:${port}/health`);
                console.log(`SSE endpoint: http://localhost:${port}/sse`);
                console.log(`Workspace: ${this.workspaceName}`);
                resolve(true);
            });
        });
    }

    /**
     * Start the MCP server with automatic retry and single-instance detection
     */
    async startWithRetry(): Promise<void> {
        const attemptStart = async () => {
            const port = this.getConfiguredPort();

            // First, check if a server is already running
            const healthCheck = await this.checkHealth(port);

            if (healthCheck.running) {
                if (healthCheck.isOurs) {
                    // Another instance of our extension is serving, just wait
                    console.log(`MCP Server already running on port ${port} (our extension), waiting...`);
                    return;
                } else {
                    // Port is occupied by something else
                    this.stopRetry();
                    vscode.window.showErrorMessage(
                        `Port ${port} is occupied by another service (not Angelscript MCP Server). ` +
                        `Please configure a different port in settings: UnrealAngelscript.mcpServerPort`
                    );
                    return;
                }
            }

            // Try to start the server
            const started = await this.tryStartServer(port);
            if (started) {
                // Successfully started, stop retrying
                this.stopRetry();
                vscode.window.showInformationMessage(
                    `Angelscript MCP Server started on port ${port}`
                );
            }
            // If not started (port binding failed), continue retrying
        };

        // Start retry loop
        this.retryInterval = setInterval(attemptStart, RETRY_INTERVAL_MS);
        
        // Also attempt immediately
        await attemptStart();
    }

    /**
     * Stop the retry loop
     */
    private stopRetry(): void {
        if (this.retryInterval) {
            clearInterval(this.retryInterval);
            this.retryInterval = null;
        }
    }

    /**
     * Stop the MCP server
     */
    async stop(): Promise<void> {
        this.stopRetry();
        
        if (this.httpServer) {
            return new Promise((resolve) => {
                this.httpServer!.close(() => {
                    this.httpServer = null;
                    this.isRunning = false;
                    console.log("Angelscript MCP Server stopped");
                    resolve();
                });
            });
        }
    }

    /**
     * Check if the server is currently running
     */
    getIsRunning(): boolean {
        return this.isRunning;
    }

    /**
     * Get the current server port
     */
    getPort(): number {
        return this.port;
    }
}
