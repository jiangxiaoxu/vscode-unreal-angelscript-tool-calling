import * as assert from 'node:assert/strict';
import test = require('node:test');
import { buildLmTextResultPartSpecs, buildMcpTextToolResponse } from '../toolResultTransport';

test('LM transport builder returns text-only part specs', () =>
{
    const parts = buildLmTextResultPartSpecs('preview text');
    assert.deepEqual(parts, [{
        type: 'text',
        text: 'preview text'
    }]);
    assert.equal('structuredContent' in (parts[0] as Record<string, unknown>), false);
});

test('MCP transport builder omits structuredContent for success and keeps isError for failures', () =>
{
    const success = buildMcpTextToolResponse('ok text', false) as Record<string, unknown>;
    assert.deepEqual(success, {
        content: [{
            type: 'text',
            text: 'ok text'
        }]
    });
    assert.equal('structuredContent' in success, false);

    const failure = buildMcpTextToolResponse('error text', true) as Record<string, unknown>;
    assert.deepEqual(failure, {
        content: [{
            type: 'text',
            text: 'error text'
        }],
        isError: true
    });
    assert.equal('structuredContent' in failure, false);
});
