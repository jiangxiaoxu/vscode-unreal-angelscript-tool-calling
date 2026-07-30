import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { LANGUAGE_SERVER_TIMEOUTS_MS } from './languageServerTimeouts';

export type EditorListenerIdentityOptions = {
    port: number;
    uprojectPath: string;
};

export type EditorConnectionTuple = {
    localAddress: string;
    localPort: number;
    remoteAddress: string;
    remotePort: number;
};

export type EditorListenerIdentityResult =
    | { ok: true; processId: number; verification: 'windows-listener-owner' | 'windows-established-owner' }
    | { ok: false; code: 'unsupported-platform' | 'owner-mismatch' | 'verification-failed'; reason: string };

export type WindowsTcpOwner = {
    LocalAddress?: string;
    LocalPort?: number;
    RemoteAddress?: string;
    RemotePort?: number;
    ProcessId?: number;
    ExecutablePath?: string | null;
    CommandLine?: string | null;
};

export type EditorListenerIdentityDependencies = {
    queryWindowsTcpOwners?: (script: string, timeoutMs: number) => Promise<unknown | EditorListenerIdentityResult>;
    ownerQueryTimeoutMs?: number;
};

function normalizedCommandPath(value: string) : string
{
    return path.normalize(value).replace(/\//g, '\\').toLowerCase();
}

function normalizedAddress(value: unknown) : string
{
    if (typeof value != 'string')
        return '';
    let normalized = value.trim().toLowerCase();
    if (normalized.startsWith('::ffff:'))
        return normalized.slice('::ffff:'.length);
    return normalized;
}

function commandLineHasExactPath(commandLine: string, expectedPath: string) : boolean
{
    let start = 0;
    while (true)
    {
        let index = commandLine.indexOf(expectedPath, start);
        if (index < 0)
            return false;
        let before = index == 0 ? '' : commandLine[index - 1];
        let afterIndex = index + expectedPath.length;
        let after = afterIndex == commandLine.length ? '' : commandLine[afterIndex];
        let whitespaceBoundary = (value: string) => value == '' || /\s/.test(value);
        let beforeBoundary = whitespaceBoundary(before)
            || (before == '"' && whitespaceBoundary(index <= 1 ? '' : commandLine[index - 2]));
        let afterBoundary = whitespaceBoundary(after)
            || (after == '"' && whitespaceBoundary(afterIndex + 1 >= commandLine.length ? '' : commandLine[afterIndex + 1]));
        if (beforeBoundary && afterBoundary)
            return true;
        start = index + 1;
    }
}

function matchesEditorProject(processInfo: WindowsTcpOwner, uprojectPath: string) : boolean
{
    if (!Number.isSafeInteger(processInfo.ProcessId) || processInfo.ProcessId! <= 0)
        return false;
    let executable = typeof processInfo.ExecutablePath == 'string'
        ? path.basename(processInfo.ExecutablePath).toLowerCase()
        : '';
    let commandLine = typeof processInfo.CommandLine == 'string'
        ? normalizedCommandPath(processInfo.CommandLine)
        : '';
    return executable.startsWith('unrealeditor')
        && commandLineHasExactPath(commandLine, normalizedCommandPath(uprojectPath));
}

function isIpv4LoopbackReachableListener(address: unknown) : boolean
{
    let normalized = normalizedAddress(address);
    return normalized == '127.0.0.1' || normalized == '0.0.0.0' || normalized == '::';
}

function asOwners(values: unknown) : WindowsTcpOwner[]
{
    return (Array.isArray(values) ? values : (values ? [values] : [])) as WindowsTcpOwner[];
}

export function validateWindowsListenerProcesses(
    values: unknown,
    options: EditorListenerIdentityOptions,
) : EditorListenerIdentityResult
{
    let listeners = asOwners(values).filter((value) =>
        value.LocalPort == options.port && isIpv4LoopbackReachableListener(value.LocalAddress));
    let ownerIds = new Set(listeners.map((value) => value.ProcessId).filter((value) => Number.isSafeInteger(value)));
    if (listeners.length == 0 || ownerIds.size != 1 || !listeners.every((value) => matchesEditorProject(value, options.uprojectPath)))
    {
        return {
            ok: false,
            code: 'owner-mismatch',
            reason: `TCP 127.0.0.1:${options.port} is not owned unambiguously by the matching Unreal Editor process.`,
        };
    }
    return { ok: true, processId: listeners[0].ProcessId!, verification: 'windows-listener-owner' };
}

function establishedTupleMatches(value: WindowsTcpOwner, tuple: EditorConnectionTuple) : boolean
{
    return normalizedAddress(value.LocalAddress) == normalizedAddress(tuple.remoteAddress)
        && value.LocalPort == tuple.remotePort
        && normalizedAddress(value.RemoteAddress) == normalizedAddress(tuple.localAddress)
        && value.RemotePort == tuple.localPort;
}

export function validateWindowsEstablishedConnection(
    values: unknown,
    options: EditorListenerIdentityOptions,
    tuple: EditorConnectionTuple,
    expectedProcessId: number,
) : EditorListenerIdentityResult
{
    let connections = asOwners(values).filter((value) => establishedTupleMatches(value, tuple));
    if (connections.length != 1 || connections[0].ProcessId != expectedProcessId
        || !matchesEditorProject(connections[0], options.uprojectPath))
    {
        return {
            ok: false,
            code: 'owner-mismatch',
            reason: `Established TCP connection to 127.0.0.1:${options.port} is not owned by the preflight Unreal Editor process.`,
        };
    }
    return { ok: true, processId: expectedProcessId, verification: 'windows-established-owner' };
}

function unsupportedPlatform(platform: NodeJS.Platform) : EditorListenerIdentityResult
{
    return {
        ok: false,
        code: 'unsupported-platform',
        reason: `Strict Unreal Editor listener ownership verification is unsupported on platform '${platform}'.`,
    };
}

function queryWindowsTcpOwners(script: string, timeoutMs: number) : Promise<unknown | EditorListenerIdentityResult>
{
    return new Promise((resolve) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            windowsHide: true,
            timeout: timeoutMs,
            maxBuffer: 256 * 1024,
        }, (error, stdout) => {
            if (error)
            {
                resolve({ ok: false, code: 'verification-failed', reason: `Editor TCP ownership query failed: ${error.message}` });
                return;
            }
            try { resolve(stdout.trim().length == 0 ? [] : JSON.parse(stdout)); }
            catch (parseError)
            {
                resolve({ ok: false, code: 'verification-failed', reason: `Editor TCP ownership response is invalid: ${String(parseError)}` });
            }
        });
    });
}

function isIdentityResult(value: unknown) : value is EditorListenerIdentityResult
{
    return !!value && typeof value == 'object' && 'ok' in value;
}

function powershellString(value: string) : string
{
    return `'${value.replace(/'/g, "''")}'`;
}

function windowsNetstatQueryPrelude() : string[]
{
    return [
        "function Convert-Endpoint { param([string]$Value) $separator=$Value.LastIndexOf(':'); if($separator -lt 0){return $null}; $address=$Value.Substring(0,$separator).Trim('[',']'); $endpointPort=0; if(-not [int]::TryParse($Value.Substring($separator+1),[ref]$endpointPort)){return $null}; [pscustomobject]@{Address=$address;Port=$endpointPort} }",
        "function Add-OwnerMetadata { param($Row) $owner=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $Row.ProcessId) -ErrorAction SilentlyContinue; [pscustomobject]@{LocalAddress=$Row.LocalAddress;LocalPort=$Row.LocalPort;RemoteAddress=$Row.RemoteAddress;RemotePort=$Row.RemotePort;ProcessId=$Row.ProcessId;ExecutablePath=$owner.ExecutablePath;CommandLine=$owner.CommandLine} }",
        "$netstatPath=[System.IO.Path]::Combine($env:SystemRoot,'System32','netstat.exe')",
    ];
}

function windowsListenerQuery(port: number) : string
{
    return [
        ...windowsNetstatQueryPrelude(),
        `$portNumber=[int]${port}`,
        "$rows=@(& $netstatPath -ano -p tcp | ForEach-Object { $columns=@($_.Trim() -split '\\s+'); if($columns.Count -ge 5 -and $columns[0] -eq 'TCP' -and $columns[3] -eq 'LISTENING'){ $local=Convert-Endpoint $columns[1]; if($null -ne $local -and $local.Port -eq $portNumber){ [pscustomobject]@{LocalAddress=$local.Address;LocalPort=$local.Port;RemoteAddress='';RemotePort=0;ProcessId=[int]$columns[4]} } } })",
        '$items=@($rows | ForEach-Object { Add-OwnerMetadata $_ })',
        '$items | ConvertTo-Json -Compress',
    ].join(';');
}

function windowsEstablishedQuery(tuple: EditorConnectionTuple) : string
{
    return [
        ...windowsNetstatQueryPrelude(),
        `$serverAddress=${powershellString(normalizedAddress(tuple.remoteAddress))}`,
        `$serverPort=[int]${tuple.remotePort}`,
        `$clientAddress=${powershellString(normalizedAddress(tuple.localAddress))}`,
        `$clientPort=[int]${tuple.localPort}`,
        "$rows=@(& $netstatPath -ano -p tcp | ForEach-Object { $columns=@($_.Trim() -split '\\s+'); if($columns.Count -ge 5 -and $columns[0] -eq 'TCP' -and $columns[3] -eq 'ESTABLISHED'){ $local=Convert-Endpoint $columns[1]; $remote=Convert-Endpoint $columns[2]; if($null -ne $local -and $null -ne $remote -and $local.Address -eq $serverAddress -and $local.Port -eq $serverPort -and $remote.Address -eq $clientAddress -and $remote.Port -eq $clientPort){ [pscustomobject]@{LocalAddress=$local.Address;LocalPort=$local.Port;RemoteAddress=$remote.Address;RemotePort=$remote.Port;ProcessId=[int]$columns[4]} } } })",
        '$items=@($rows | ForEach-Object { Add-OwnerMetadata $_ })',
        '$items | ConvertTo-Json -Compress',
    ].join(';');
}

export async function verifyEditorListenerIdentity(
    options: EditorListenerIdentityOptions,
    platform: NodeJS.Platform = process.platform,
    dependencies: EditorListenerIdentityDependencies = {},
) : Promise<EditorListenerIdentityResult>
{
    if (platform != 'win32')
        return unsupportedPlatform(platform);
    let query = dependencies.queryWindowsTcpOwners ?? queryWindowsTcpOwners;
    let queried = await query(
        windowsListenerQuery(options.port),
        dependencies.ownerQueryTimeoutMs ?? LANGUAGE_SERVER_TIMEOUTS_MS.windowsEditorOwnerQuery,
    );
    return isIdentityResult(queried) ? queried : validateWindowsListenerProcesses(queried, options);
}

export async function verifyEstablishedEditorConnectionIdentity(
    options: EditorListenerIdentityOptions,
    tuple: EditorConnectionTuple,
    expectedProcessId: number,
    platform: NodeJS.Platform = process.platform,
    dependencies: EditorListenerIdentityDependencies = {},
) : Promise<EditorListenerIdentityResult>
{
    if (platform != 'win32')
        return unsupportedPlatform(platform);
    let query = dependencies.queryWindowsTcpOwners ?? queryWindowsTcpOwners;
    let queried = await query(
        windowsEstablishedQuery(tuple),
        dependencies.ownerQueryTimeoutMs ?? LANGUAGE_SERVER_TIMEOUTS_MS.windowsEditorOwnerQuery,
    );
    return isIdentityResult(queried)
        ? queried
        : validateWindowsEstablishedConnection(queried, options, tuple, expectedProcessId);
}
