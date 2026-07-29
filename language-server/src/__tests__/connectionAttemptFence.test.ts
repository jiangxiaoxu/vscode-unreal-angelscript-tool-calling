import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnectionAttemptFence } from '../connectionAttemptFence';

test('shutdown cancellation fences a delayed verifier before socket creation', async () => {
    let fence = createConnectionAttemptFence();
    let token = fence.begin();
    let release!: () => void;
    let verifier = new Promise<void>((resolve) => { release = resolve; });
    let socketCreated = false;
    let attempt = (async () => {
        await verifier;
        if (!fence.isCurrent(token))
            return;
        socketCreated = true;
    })();
    fence.cancel();
    release();
    await attempt;
    assert.equal(socketCreated, false);
    assert.equal(fence.hasActive(), false);
});
