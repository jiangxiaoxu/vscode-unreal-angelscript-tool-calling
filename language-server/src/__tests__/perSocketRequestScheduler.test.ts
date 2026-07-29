import assert from 'node:assert/strict';
import test from 'node:test';
import { createPerSocketRequestScheduler } from '../perSocketRequestScheduler';

test('a replaced verified socket cannot send into a socket whose postflight is still pending', async () => {
    let scheduler = createPerSocketRequestScheduler<object>();
    let socketA = {};
    let socketB = {};
    let current = socketA;
    let sent: string[] = [];
    scheduler.schedule(socketA, 10, () => current === socketA, () => sent.push('A'));

    current = socketB;
    scheduler.cancel(socketA);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(sent, []);

    scheduler.schedule(socketB, 5, () => current === socketB, () => sent.push('B'));
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.deepEqual(sent, ['B']);
});

test('the current-socket guard fences a stale timer even without explicit cancellation', async () => {
    let scheduler = createPerSocketRequestScheduler<object>();
    let socketA = {};
    let socketB = {};
    let current = socketA;
    let sends = 0;
    scheduler.schedule(socketA, 5, () => current === socketA, () => { sends += 1; });
    current = socketB;
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(sends, 0);
    scheduler.cancelAll();
});
