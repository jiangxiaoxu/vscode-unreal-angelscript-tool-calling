import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test = require('node:test');
import { pathToFileURL } from 'node:url';
import { runFindReferences } from '../toolShared';

function createReferenceLocation(
    filePath: string,
    line: number,
    startCharacter: number,
    endCharacter: number
)
{
    return {
        uri: pathToFileURL(filePath).toString(),
        range: {
            start: { line, character: startCharacter },
            end: { line, character: endCharacter }
        }
    };
}

test('runFindReferences filters Super alias references before applying limit', async (t) =>
{
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'angelscript-findrefs-'));
    t.after(async () =>
    {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    const scriptPath = path.join(tempDir, 'Hero.as');
    await fs.writeFile(
        scriptPath,
        [
            'Super::BeginPlay();',
            'Super::OnDeathStarted();',
            'BeginPlay();'
        ].join('\n'),
        'utf8'
    );

    const sentRequests: unknown[] = [];
    const client = {
        sendRequest: async (_method: unknown, payload: unknown) =>
        {
            sentRequests.push(payload);
            return [
                createReferenceLocation(scriptPath, 0, 7, 16),
                createReferenceLocation(scriptPath, 1, 7, 21),
                createReferenceLocation(scriptPath, 2, 0, 9)
            ];
        }
    } as any;

    const result = await runFindReferences(
        client,
        Promise.resolve(),
        {
            filePath: scriptPath,
            position: {
                line: 3,
                character: 1
            },
            limit: 1
        }
    );

    assert.equal(sentRequests.length, 1);
    assert.equal(result.ok, true);
    if (!result.ok)
        assert.fail('Expected runFindReferences to succeed.');

    assert.equal(result.data.total, 1);
    assert.equal(result.data.returned, 1);
    assert.equal(result.data.limit, 1);
    assert.equal(result.data.truncated, false);
    assert.equal(result.data.references.length, 1);
    assert.deepEqual(result.data.references[0].range, {
        start: { line: 3, character: 1 },
        end: { line: 3, character: 10 }
    });
    assert.equal(result.data.references[0].preview, 'BeginPlay();');
});
