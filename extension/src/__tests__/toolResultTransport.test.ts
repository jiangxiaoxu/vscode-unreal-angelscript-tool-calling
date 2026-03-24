import * as assert from 'node:assert/strict';
import test = require('node:test');
import { buildLmToolResultPartSpecs } from '../toolResultTransport';

test('LM transport builder returns text and structured json when output mode is text+structured', () =>
{
    const payload = {
        ok: true,
        data: {
            matches: []
        }
    };
    const parts = buildLmToolResultPartSpecs('preview text', payload, 'text+structured');
    assert.deepEqual(parts, [
        {
            type: 'text',
            text: 'preview text'
        },
        {
            type: 'json',
            value: payload
        }
    ]);
});

test('LM transport builder returns text only when output mode is text-only', () =>
{
    const parts = buildLmToolResultPartSpecs('preview text', { ok: true }, 'text-only');
    assert.deepEqual(parts, [{
        type: 'text',
        text: 'preview text'
    }]);
});

test('LM transport builder preserves structured error payload shape', () =>
{
    const payload = {
        ok: false,
        error: {
            code: 'INVALID_QUERY',
            message: 'Invalid query.'
        }
    };
    const parts = buildLmToolResultPartSpecs('error text', payload, 'text+structured');
    assert.deepEqual(parts[1], {
        type: 'json',
        value: payload
    });
});
