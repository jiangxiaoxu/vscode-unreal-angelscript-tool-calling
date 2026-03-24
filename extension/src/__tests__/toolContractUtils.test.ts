import * as assert from 'node:assert/strict';
import test = require('node:test');
import * as path from 'path';
import {
    applyResultLimit,
    DEFAULT_FIND_REFERENCES_LIMIT,
    normalizeFindReferencesLimit,
    normalizeHierarchySourceFilePath,
    resolveAbsoluteToolFilePathInput,
    toOutputPath
} from '../toolContractUtils';

test('absolute file path resolver accepts normalized absolute paths only', () =>
{
    const absolutePath = path.join(process.cwd(), 'Script', 'Hero.as');
    const resolved = resolveAbsoluteToolFilePathInput(absolutePath);
    assert.equal(resolved.ok, true);
    if (resolved.ok)
    {
        assert.equal(resolved.absolutePath, path.normalize(absolutePath));
        assert.match(resolved.uri, /^file:\/\//u);
    }

    const relativeResult = resolveAbsoluteToolFilePathInput(path.join('Script', 'Hero.as'));
    assert.deepEqual(relativeResult, {
        ok: false,
        message: "Invalid params. 'filePath' must be an absolute file system path.",
        details: {
            filePath: path.join('Script', 'Hero.as')
        }
    });
});

test('findReferences limit normalization uses default 30 and validates range', () =>
{
    assert.deepEqual(normalizeFindReferencesLimit(undefined), {
        ok: true,
        value: DEFAULT_FIND_REFERENCES_LIMIT
    });
    assert.deepEqual(normalizeFindReferencesLimit(1), {
        ok: true,
        value: 1
    });
    assert.deepEqual(normalizeFindReferencesLimit(200), {
        ok: true,
        value: 200
    });
    assert.deepEqual(normalizeFindReferencesLimit(0), {
        ok: false,
        message: "Invalid params. 'limit' must be between 1 and 200.",
        details: {
            receivedLimit: 0
        }
    });
    assert.deepEqual(normalizeFindReferencesLimit(201), {
        ok: false,
        message: "Invalid params. 'limit' must be between 1 and 200.",
        details: {
            receivedLimit: 201
        }
    });
});

test('findReferences result limit preserves total and truncation metadata', () =>
{
    assert.deepEqual(applyResultLimit([1, 2, 3, 4], 2), {
        items: [1, 2],
        total: 4,
        returned: 2,
        limit: 2,
        truncated: true
    });
    assert.deepEqual(applyResultLimit([1, 2], 5), {
        items: [1, 2],
        total: 2,
        returned: 2,
        limit: 5,
        truncated: false
    });
});

test('hierarchy source path normalization degrades unresolved paths to unavailable', () =>
{
    const absolutePath = path.join(process.cwd(), 'Script', 'Characters', 'Hero.as');
    assert.equal(
        normalizeHierarchySourceFilePath(absolutePath),
        path.normalize(absolutePath)
    );
    assert.equal(normalizeHierarchySourceFilePath('Gameplay/Hero'), null);
    assert.equal(normalizeHierarchySourceFilePath(''), null);
    assert.equal(normalizeHierarchySourceFilePath(undefined), null);
});

test('output paths always use forward slashes', () =>
{
    const normalized = toOutputPath(path.join('G:', 'Project', 'Script', 'Hero.as'));
    assert.match(normalized, /\//u);
    assert.doesNotMatch(normalized, /\\/u);
});
