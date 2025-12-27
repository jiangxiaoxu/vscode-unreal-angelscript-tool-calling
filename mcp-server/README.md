# Angelscript MCP Server

An MCP (Model Context Protocol) server that exposes the Angelscript API search functionality, enabling Codex and other MCP-compatible clients to search the Angelscript API database.

## Architecture

The MCP server is **integrated into the VS Code extension** and uses Streamable HTTP mode with single-instance detection:

1. The MCP server auto-starts when the VS Code extension activates (when opening .as files or debugging)
2. It shares the LanguageClient with the extension
3. Only one instance runs across multiple VS Code windows (single-instance mode)
4. Uses Streamable HTTP transport for Codex compatibility

### Single-Instance Behavior

When multiple VS Code windows are open:

- Each window attempts to start the MCP server every 1 second
- Health check timeout is 300-500ms
- The first window to bind the port becomes the active server
- Other windows detect the running server via `/health` endpoint and wait
- If the port is occupied by a non-Angelscript service (serverId mismatch), an error notification is shown immediately
- If binding fails 5 times (configurable), an error notification is shown and retrying stops

## Features

- **Search_AngelScriptApi**: Search the Angelscript API database for symbols and documentation

## Configuration

Add the following to your VS Code settings if you need to change the default port:

```json
{
    "UnrealAngelscript.mcp.port": 27199,
    "UnrealAngelscript.mcp.maxRetryCount": 5
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `UnrealAngelscript.mcp.port` | 0 (auto) | MCP server port. If 0, uses `unrealConnectionPort + 100` |
| `UnrealAngelscript.mcp.maxRetryCount` | 5 | Max retry attempts before showing error |

## Usage with Codex

Configure in `~/.codex/config.toml`:

```toml
[mcp_servers.angelscript]
url = "http://localhost:27199/sse"
```

Replace `27199` with your configured port if different.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check, returns server status and ID |
| `/sse` | GET | SSE endpoint for MCP protocol |
| `/message` | POST | Message endpoint for MCP protocol |

### Health Check Response

```json
{
    "status": "ok",
    "serverId": "angelscript-mcp-server-v1",
    "workspace": "MyProject",
    "port": 27199
}
```

## VS Code Commands

- `angelscript.stopMcpServer` - Stop the MCP server
- `angelscript.mcpServerStatus` - Show MCP server status

## Tool: Search_AngelScriptApi

Search the Angelscript API database for symbols and documentation.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | - | Search query text for Angelscript API symbols |
| `limit` | number | No | 500 | Maximum number of results to return (1-1000) |
| `includeDetails` | boolean | No | true | Include documentation details for top matches |

### Example

```json
{
  "query": "GetActor",
  "limit": 100,
  "includeDetails": true
}
```

### Response

Returns a JSON object with:

```json
{
  "query": "GetActor",
  "total": 150,
  "returned": 100,
  "truncated": true,
  "items": [
    {
      "label": "AActor.GetActorLocation()",
      "type": "function",
      "data": ["method", "AActor", "GetActorLocation", 123],
      "details": "```angelscript_snippet\nFVector AActor.GetActorLocation()\n```\n..."
    }
  ]
}
```

## Requirements

- Node.js >= 18.0.0
- VS Code with the Unreal Angelscript extension installed
- The language server must be running and connected to Unreal Engine

## License

MIT
