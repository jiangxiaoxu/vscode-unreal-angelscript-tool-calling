import assert from 'node:assert/strict';
import test from 'node:test';
import {
    validateWindowsEstablishedConnection,
    validateWindowsListenerProcesses,
    verifyEditorListenerIdentity,
} from '../editorListenerIdentity';

const options = {
    port: 27099,
    uprojectPath: 'G:\\Project\\Game\\Game.uproject',
};
const editor = {
    ProcessId: 42,
    ExecutablePath: 'C:\\UE\\UnrealEditor.exe',
    CommandLine: '"C:\\UE\\UnrealEditor.exe" "G:\\Project\\Game\\Game.uproject"',
};

test('preflight accepts only an unambiguous IPv4-loopback-reachable matching listener', () => {
    assert.deepEqual(validateWindowsListenerProcesses({
        ...editor,
        LocalAddress: '127.0.0.1',
        LocalPort: 27099,
    }, options), { ok: true, processId: 42, verification: 'windows-listener-owner' });

    let dualAddressDifferentOwners = validateWindowsListenerProcesses([
        { ...editor, LocalAddress: '::', LocalPort: 27099 },
        {
            ProcessId: 99,
            ExecutablePath: 'C:\\Other\\Other.exe',
            CommandLine: 'Other.exe',
            LocalAddress: '127.0.0.1',
            LocalPort: 27099,
        },
    ], options);
    assert.equal(dualAddressDifferentOwners.ok, false);

    let ipv6OnlyEditorWithDifferentIpv4Owner = validateWindowsListenerProcesses([
        { ...editor, LocalAddress: '::1', LocalPort: 27099 },
        {
            ProcessId: 99,
            ExecutablePath: 'C:\\Other\\Other.exe',
            CommandLine: 'Other.exe',
            LocalAddress: '127.0.0.1',
            LocalPort: 27099,
        },
    ], options);
    assert.equal(ipv6OnlyEditorWithDifferentIpv4Owner.ok, false);
    assert.equal(validateWindowsListenerProcesses({
        ...editor,
        CommandLine: `${editor.CommandLine}.backup`,
        LocalAddress: '127.0.0.1',
        LocalPort: 27099,
    }, options).ok, false, 'The project path must be a complete command-line argument.');
});

test('postflight binds the exact established socket tuple to the preflight Editor PID', () => {
    let tuple = {
        localAddress: '127.0.0.1',
        localPort: 50123,
        remoteAddress: '127.0.0.1',
        remotePort: 27099,
    };
    let established = {
        ...editor,
        LocalAddress: '127.0.0.1',
        LocalPort: 27099,
        RemoteAddress: '127.0.0.1',
        RemotePort: 50123,
    };
    assert.deepEqual(validateWindowsEstablishedConnection(established, options, tuple, 42), {
        ok: true,
        processId: 42,
        verification: 'windows-established-owner',
    });
    assert.equal(validateWindowsEstablishedConnection({ ...established, ProcessId: 99 }, options, tuple, 42).ok, false);
    assert.equal(validateWindowsEstablishedConnection({ ...established, RemotePort: 50124 }, options, tuple, 42).ok, false);
});

test('unsupported platforms fail closed instead of authorizing a blind TCP connection', async () => {
    for (let platform of ['linux', 'darwin'] as NodeJS.Platform[])
    {
        let result = await verifyEditorListenerIdentity(options, platform);
        assert.deepEqual(result, {
            ok: false,
            code: 'unsupported-platform',
            reason: `Strict Unreal Editor listener ownership verification is unsupported on platform '${platform}'.`,
        });
    }
});
