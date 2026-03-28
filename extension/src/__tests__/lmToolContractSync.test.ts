import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test = require('node:test');
import { pathToFileURL } from 'node:url';

function getRepoRoot(): string
{
    return path.resolve(__dirname, '..', '..', '..');
}

async function loadManifestModule()
{
    const modulePath = path.join(getRepoRoot(), 'scripts', 'lmToolManifest.mjs');
    const dynamicImport = new Function('modulePath', 'return import(modulePath);') as (modulePath: string) => Promise<any>;
    return await dynamicImport(pathToFileURL(modulePath).href);
}

function readRepoFile(...parts: string[]): string
{
    return fs.readFileSync(path.join(getRepoRoot(), ...parts), 'utf8').replace(/\r\n/gu, '\n');
}

function extractRegisteredToolNames(toolRegistryText: string): string[]
{
    const names: string[] = [];
    const pattern = /name:\s*'([^']+)'/gu;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(toolRegistryText)) !== null)
        names.push(match[1]);
    return names;
}

test('package.json languageModelTools matches the manifest source', async () =>
{
    const manifestModule = await loadManifestModule();
    const packageJson = JSON.parse(readRepoFile('package.json'));
    assert.deepEqual(
        packageJson.contributes.languageModelTools,
        manifestModule.getLanguageModelToolsContribution()
    );
});

test('README generated LM tool blocks match the manifest source', async () =>
{
    const manifestModule = await loadManifestModule();
    const readme = readRepoFile('README.md');
    assert.ok(
        readme.includes(
            manifestModule.buildGeneratedBlock(
                manifestModule.README_EN_MARKER,
                manifestModule.renderReadmeLmToolsBlock('en')
            )
        )
    );
    assert.ok(
        readme.includes(
            manifestModule.buildGeneratedBlock(
                manifestModule.README_ZH_MARKER,
                manifestModule.renderReadmeLmToolsBlock('zh')
            )
        )
    );
});

test('face-ai-report generated block matches the manifest source', async () =>
{
    const manifestModule = await loadManifestModule();
    const report = readRepoFile('face-ai-report.md');
    assert.ok(
        report.includes(
            manifestModule.buildGeneratedBlock(
                manifestModule.FACE_AI_REPORT_MARKER,
                manifestModule.renderFaceAiReportBlock()
            )
        )
    );
});

test('toolRegistry runtime tool names stay aligned with the public manifest names', async () =>
{
    const manifestModule = await loadManifestModule();
    const toolRegistry = readRepoFile('extension', 'src', 'toolRegistry.ts');
    assert.deepEqual(
        extractRegisteredToolNames(toolRegistry),
        manifestModule.getLmToolNames()
    );
});
