import * as assert from 'node:assert/strict';
import test = require('node:test');
import type { GetAPISearchParams } from '../apiRequests';

test('GetAPISearchParams exposes offset for paged API panel requests', () =>
{
    const request: GetAPISearchParams = {
        query: 'Movement',
        limit: 20,
        offset: 20,
    };
    assert.equal(request.offset, 20);
});
