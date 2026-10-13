import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createUnrealReconnectScheduler,
    TimeoutHandle,
} from '../unrealReconnectScheduler';

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
