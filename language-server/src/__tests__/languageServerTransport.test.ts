import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ChildProcess, fork, spawn } from 'node:child_process';
import { saveDebugDatabaseCacheV2 } from '../debugDatabaseCacheV2';
import { DEFAULT_LANGUAGE_SERVER_BUDGETS } from '../languageServerContract';
import { decodeApiQueryIndex } from '../apiQueryIndexRuntime';

type JsonRpcMessage = {
    jsonrpc: '2.0';
    id?: number;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: unknown;
};

type TestClient = {
    child: ChildProcess;
    send: (message: JsonRpcMessage) => void;
    request: (method: string, params?: unknown) => Promise<JsonRpcMessage>;
    close: () => Promise<void>;
};

function createProject(content = 'class transport_fixture { int Bad_name; }\n') : string
{
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'as-ls-transport-'));
    fs.mkdirSync(path.join(root, 'Script'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Script', 'TransportFixture.as'), content);
    return root;
}

function writeEmptyNativeCache(root: string, projectIdentity: string) : string
{
    let cachePath = path.join(root, 'Saved', 'ASEditorAutomation', 'LanguageServer', 'debug-database.v2.json.gz');
    saveDebugDatabaseCacheV2({
        cachePath,
        access: 'read-write',
        projectIdentity,
        budgets: DEFAULT_LANGUAGE_SERVER_BUDGETS,
    }, {
        projectIdentity,
        producer: { extensionVersion: '1.9.3070', languageServerCommit: 'development' },
        scriptSettings: {
            floatIsFloat64: false,
            useAngelscriptHaze: false,
            deprecateStaticClass: false,
            disallowStaticClass: false,
            exposeGlobalFunctions: false,
            deprecateActorGenerics: false,
            disallowActorGenerics: false,
        },
        engineSupportsCreateBlueprint: false,
        debugDatabaseChunks: [{}],
    });
    return cachePath;
}

function createClient(transport: 'stdio' | 'ipc') : TestClient
{
    let server = path.resolve('language-server', 'dist', 'server.js');
    let child = transport == 'stdio'
        ? spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
        : fork(server, [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let nextId = 1;
    let pending = new Map<number, (message: JsonRpcMessage) => void>();
    let accept = (message: JsonRpcMessage) => {
        if (typeof message.id == 'number' && pending.has(message.id))
        {
            pending.get(message.id)!(message);
            pending.delete(message.id);
        }
    };
    if (transport == 'stdio')
    {
        let buffer = Buffer.alloc(0);
        child.stdout!.on('data', (data: Buffer) => {
            buffer = Buffer.concat([buffer, data]);
            while (true)
            {
                let headerEnd = buffer.indexOf('\r\n\r\n');
                if (headerEnd < 0)
                    break;
                let header = buffer.subarray(0, headerEnd).toString('ascii');
                let length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1]);
                if (!Number.isSafeInteger(length) || buffer.length < headerEnd + 4 + length)
                    break;
                let body = buffer.subarray(headerEnd + 4, headerEnd + 4 + length);
                buffer = buffer.subarray(headerEnd + 4 + length);
                accept(JSON.parse(body.toString('utf8')));
            }
        });
    }
    else
    {
        child.on('message', (message) => accept(message as JsonRpcMessage));
    }
    function send(message: JsonRpcMessage) : void
    {
        if (transport == 'stdio')
        {
            let body = Buffer.from(JSON.stringify(message), 'utf8');
            child.stdin!.write(`Content-Length: ${body.length}\r\n\r\n`);
            child.stdin!.write(body);
        }
        else
        {
            child.send!(message);
        }
    }
    function request(method: string, params: unknown = {}) : Promise<JsonRpcMessage>
    {
        let id = nextId++;
        return new Promise((resolve, reject) => {
            let timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`Timed out waiting for ${method}.`));
            }, 8000);
            pending.set(id, (message) => {
                clearTimeout(timer);
                resolve(message);
            });
            send({ jsonrpc: '2.0', id, method, params });
        });
    }
    async function close() : Promise<void>
    {
        if (child.exitCode == null)
        {
            try { await request('shutdown'); } catch {}
            send({ jsonrpc: '2.0', method: 'exit' });
        }
        await new Promise<void>((resolve) => {
            if (child.exitCode != null)
                return resolve();
            let timer = setTimeout(() => { child.kill(); resolve(); }, 3000);
            child.once('exit', () => { clearTimeout(timer); resolve(); });
        });
    }
    return { child, send, request, close };
}

for (let transport of ['stdio', 'ipc'] as const)
{
    test(`Language Server ${transport} supports offline initialize, status, workspace diagnostics, and bounded shutdown`, async () => {
        let root = createProject();
        let client = createClient(transport);
        try
        {
            let initialize = await client.request('initialize', {
                processId: process.pid,
                rootUri: `file:///${root.replace(/\\/g, '/')}`,
                capabilities: { textDocument: { publishDiagnostics: { relatedInformation: true } } },
                initializationOptions: {
                    role: 'cli-direct',
                    canonicalProjectRoot: root,
                    projectIdentity: 'transport-fixture',
                    unreal: { online: false, debuggerPort: 27099 },
                    cache: {
                        access: 'read-only',
                        path: path.join(root, 'Saved', 'ASEditorAutomation', 'LanguageServer', 'debug-database.v2.json.gz'),
                    },
                },
            });
            assert.equal(initialize.error, undefined);
            let capabilities = (initialize.result as { capabilities: Record<string, unknown> }).capabilities;
            assert.ok(capabilities.diagnosticProvider);
            client.send({ jsonrpc: '2.0', method: 'initialized', params: {} });
            let status = await client.request('angelscript/diagnosticsStatus');
            assert.equal((status.result as { unrealOnline: boolean }).unrealOnline, false);
            let apiStart = Date.now();
            let apiEarly = await client.request('angelscript/queryAPI', { query: 'AActor' });
            assert.ok(apiEarly.error);
            assert.ok(Date.now() - apiStart < 1000, 'Terminal partial coverage must fail API queries without the readiness retry window.');
            let diagnosticItems: unknown[] = [];
            for (let attempt = 0; attempt < 40 && diagnosticItems.length == 0; attempt += 1)
            {
                let diagnostics = await client.request('workspace/diagnostic', { previousResultIds: [] });
                diagnosticItems = (diagnostics.result as { items: unknown[] }).items;
                if (diagnosticItems.length == 0)
                    await new Promise((resolve) => setTimeout(resolve, 25));
            }
            assert.ok(diagnosticItems.length > 0, 'Expected parse-only diagnostics for the invalid naming fixture.');
            let firstWorkspaceItem = diagnosticItems[0] as { uri: string; kind: string; resultId: string };
            assert.equal(firstWorkspaceItem.kind, 'full');
            let documentFull = await client.request('textDocument/diagnostic', {
                textDocument: { uri: firstWorkspaceItem.uri },
            });
            assert.equal((documentFull.result as { kind: string }).kind, 'full');
            let documentResultId = (documentFull.result as { resultId: string }).resultId;
            let documentUnchanged = await client.request('textDocument/diagnostic', {
                textDocument: { uri: firstWorkspaceItem.uri },
                previousResultId: documentResultId,
            });
            assert.deepEqual(documentUnchanged.result, { kind: 'unchanged', resultId: documentResultId });
            let workspaceUnchanged = await client.request('workspace/diagnostic', {
                previousResultIds: [{ uri: firstWorkspaceItem.uri, value: firstWorkspaceItem.resultId }],
            });
            assert.equal(((workspaceUnchanged.result as { items: Array<{ kind: string }> }).items[0]).kind, 'unchanged');
        }
        finally
        {
            await client.close();
            fs.rmSync(root, { recursive: true, force: true });
        }
        assert.notEqual(client.child.exitCode, null);
    });
}

test('cached stdio startup resolves loaded scripts before publishing full readiness', async () => {
    let root = createProject();
    let projectIdentity = 'cached-transport-fixture';
    let cachePath = writeEmptyNativeCache(root, projectIdentity);
    let client = createClient('stdio');
    try
    {
        let initialize = await client.request('initialize', {
            processId: process.pid,
            rootUri: `file:///${root.replace(/\\/g, '/')}`,
            capabilities: { textDocument: { publishDiagnostics: { relatedInformation: true } } },
            initializationOptions: {
                role: 'cli-direct',
                canonicalProjectRoot: root,
                projectIdentity,
                unreal: { online: false },
                cache: { access: 'read-only', path: cachePath },
            },
        });
        assert.equal(initialize.error, undefined);
        client.send({ jsonrpc: '2.0', method: 'initialized', params: {} });
        let fullReady = false;
        for (let attempt = 0; attempt < 80 && !fullReady; attempt += 1)
        {
            let status = await client.request('angelscript/diagnosticsStatus');
            fullReady = (status.result as { fullReady: boolean }).fullReady;
            if (!fullReady)
                await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.equal(fullReady, true, 'A valid cache must let the resolve queue drain before full readiness.');
    }
    finally
    {
        await client.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('zero-diagnostic symbol rename republishes the script-revision API index', async () => {
    let root = createProject('class UIndexBefore {}\n');
    let projectIdentity = 'script-revision-transport-fixture';
    let cachePath = writeEmptyNativeCache(root, projectIdentity);
    let indexPath = path.join(path.dirname(cachePath), 'api-query-index.v1.json.gz');
    let scriptPath = path.join(root, 'Script', 'TransportFixture.as');
    let scriptUri = `file:///${scriptPath.replace(/\\/g, '/')}`;
    let client = createClient('stdio');
    try
    {
        let initialize = await client.request('initialize', {
            processId: process.pid,
            rootUri: `file:///${root.replace(/\\/g, '/')}`,
            capabilities: { textDocument: { publishDiagnostics: { relatedInformation: true } } },
            initializationOptions: {
                role: 'ue-resident',
                canonicalProjectRoot: root,
                projectIdentity,
                unreal: { online: false },
                cache: { access: 'read-write', path: cachePath },
            },
        });
        assert.equal(initialize.error, undefined);
        client.send({ jsonrpc: '2.0', method: 'initialized', params: {} });
        for (let attempt = 0; attempt < 80; attempt += 1)
        {
            let status = await client.request('angelscript/diagnosticsStatus');
            if ((status.result as { fullReady: boolean }).fullReady)
                break;
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        let beforeRevision = '';
        for (let attempt = 0; attempt < 80 && !beforeRevision; attempt += 1)
        {
            if (fs.existsSync(indexPath))
            {
                try { beforeRevision = decodeApiQueryIndex(fs.readFileSync(indexPath)).scriptContentRevision; } catch {}
            }
            if (!beforeRevision)
                await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.ok(beforeRevision);

        client.send({
            jsonrpc: '2.0',
            method: 'textDocument/didOpen',
            params: { textDocument: { uri: scriptUri, languageId: 'angelscript', version: 1, text: 'class UIndexBefore {}\n' } },
        });
        client.send({
            jsonrpc: '2.0',
            method: 'textDocument/didChange',
            params: { textDocument: { uri: scriptUri, version: 2 }, contentChanges: [{ text: 'class UIndexAfter {}\n' }] },
        });
        let afterRevision = beforeRevision;
        let afterNames: string[] = [];
        for (let attempt = 0; attempt < 120 && afterRevision == beforeRevision; attempt += 1)
        {
            await new Promise((resolve) => setTimeout(resolve, 25));
            try
            {
                let index = decodeApiQueryIndex(fs.readFileSync(indexPath));
                afterRevision = index.scriptContentRevision;
                afterNames = index.records.map((record) => record.qualifiedName);
            }
            catch {}
        }
        assert.notEqual(afterRevision, beforeRevision);
        assert.ok(afterNames.includes('UIndexAfter'));
        assert.equal(afterNames.includes('UIndexBefore'), false);
    }
    finally
    {
        await client.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
