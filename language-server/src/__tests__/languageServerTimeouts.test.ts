import assert from 'node:assert/strict';
import test from 'node:test';
import { LANGUAGE_SERVER_TIMEOUTS_MS } from '../languageServerTimeouts';
import {
    createUnrealReconnectScheduler,
    TimeoutHandle,
} from '../unrealReconnectScheduler';

test('production timeout budgets remain explicit and seconds-bounded', () => {
    assert.deepEqual(LANGUAGE_SERVER_TIMEOUTS_MS, {
        unrealReconnectDelay: 2000,
        windowsEditorOwnerQuery: 2000,
        verifiedDebugDatabaseRequestDelay: 250,
        initialOnlineNoTypeDbClassification: 5000,
        apiFullReadyWait: 2000,
        apiFullReadyPoll: 50,
        workspaceDiagnosticsSettle: 4000,
        workspaceDiagnosticsPoll: 10,
        shutdownPersistenceFlush: 1000,
        debugDatabaseChunkIntermessage: 1000,
        parentProcessWatchdog: 1000,
        cachePersistenceRetry: [1000, 3000, 5000],
    });
});
test('Unreal reconnect scheduling is single-flight, cancellable, and injectable', () => {
    let allowed = true;
    let reconnects = 0;
    let scheduled: Array<{ callback: () => void; delayMs: number; handle: TimeoutHandle }> = [];
    let cleared: TimeoutHandle[] = [];
    let nextHandle = 1;
    let scheduler = createUnrealReconnectScheduler(
        () => { reconnects += 1; },
        () => allowed,
        7,
        {
            setTimeout(callback, delayMs) {
                let handle = nextHandle++ as unknown as TimeoutHandle;
                scheduled.push({ callback, delayMs, handle });
                return handle;
            },
            clearTimeout(handle) { cleared.push(handle); },
        },
    );

    scheduler.schedule();
    scheduler.schedule();
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delayMs, 7);
    assert.equal(scheduler.hasPending(), true);
    scheduled[0].callback();
    assert.equal(reconnects, 1);
    assert.equal(scheduler.hasPending(), false);

    scheduler.schedule();
    scheduler.cancel();
    assert.deepEqual(cleared, [scheduled[1].handle]);
    assert.equal(scheduler.hasPending(), false);

    allowed = false;
    scheduler.schedule();
    assert.equal(scheduled.length, 2);
});
