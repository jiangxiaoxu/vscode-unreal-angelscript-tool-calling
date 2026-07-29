import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { removeLegacyCacheAfterVerifiedPublish } from '../legacyCacheCleanup';

test('legacy cleanup removes only a regular file and treats absence as success', () => {
    let root = fs.mkdtempSync(path.join(os.tmpdir(), 'as-legacy-cache-'));
    let legacy = path.join(root, 'unreal-cache.json');
    try
    {
        assert.deepEqual(removeLegacyCacheAfterVerifiedPublish(legacy), { ok: true, removed: false });
        fs.writeFileSync(legacy, '{}');
        assert.deepEqual(removeLegacyCacheAfterVerifiedPublish(legacy), { ok: true, removed: true });
        assert.equal(fs.existsSync(legacy), false);
        fs.mkdirSync(legacy);
        let rejected = removeLegacyCacheAfterVerifiedPublish(legacy);
        assert.equal(rejected.ok, false);
        assert.equal(fs.existsSync(legacy), true);
    }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
});
