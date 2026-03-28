import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);

function readArg(name, defaultValue) {
    const index = args.indexOf(name);
    if (index === -1)
        return defaultValue;
    const next = args[index + 1];
    if (!next || next.startsWith('--'))
        return defaultValue;
    return next;
}

function runGit(argsList) {
    return execFileSync('git', argsList, {
        cwd: process.cwd(),
        encoding: 'utf8',
    }).trim();
}

function listMatches(files, patterns) {
    return files.filter((file) => patterns.some((pattern) => file === pattern || file.startsWith(pattern)));
}

function printSection(title, items) {
    console.log(`\n${title}`);
    if (items.length === 0) {
        console.log('- none');
        return;
    }

    for (const item of items)
        console.log(`- ${item}`);
}

const baseRef = readArg('--base', 'upstream/master');

try {
    runGit(['rev-parse', '--verify', baseRef]);
} catch (error) {
    console.error(`Base ref not found: ${baseRef}`);
    process.exit(1);
}

const changedFilesOutput = runGit(['diff', '--name-only', `${baseRef}..HEAD`]);
const changedFiles = changedFilesOutput.length === 0
    ? []
    : changedFilesOutput.split(/\r?\n/).filter((line) => line.length > 0);

const highConflictFiles = [
    'extension/src/extension.ts',
    'language-server/src/server.ts',
    'language-server/src/symbols.ts',
    'package.json',
];

const boundaryFiles = [
    'extension/src/toolRegistry.ts',
    'extension/src/toolShared.ts',
    'extension/src/toolTextFormatter.ts',
    'extension/src/toolResultTransport.ts',
    'extension/src/toolContractUtils.ts',
    'extension/src/angelscriptApiSearch.ts',
    'extension/src/apiRequests.ts',
    'language-server/src/api_search.ts',
    'scripts/lmToolManifest.mjs',
    'scripts/sync-lm-tools.mjs',
];

const contractSensitiveFiles = [
    'package.json',
    'extension/src/toolRegistry.ts',
    'extension/src/toolShared.ts',
    'extension/src/angelscriptApiSearch.ts',
    'extension/src/apiRequests.ts',
    'language-server/src/api_search.ts',
    'language-server/src/server.ts',
    'scripts/lmToolManifest.mjs',
    'scripts/sync-lm-tools.mjs',
];

const docsFiles = [
    'README.md',
    'CHANGELOG.md',
    'MAINTAINING.md',
    'face-ai-report.md',
];

const highConflictChanges = listMatches(changedFiles, highConflictFiles);
const boundaryChanges = listMatches(changedFiles, boundaryFiles);
const contractChanges = listMatches(changedFiles, contractSensitiveFiles);
const docsChanges = listMatches(changedFiles, docsFiles);

const schemaChanged = changedFiles.some((file) =>
    file === 'package.json'
    || file === 'extension/src/toolRegistry.ts'
    || file === 'extension/src/apiRequests.ts'
    || file === 'scripts/lmToolManifest.mjs'
);

const activationChanged = changedFiles.some((file) =>
    file === 'package.json'
    || file === 'extension/src/extension.ts'
);

const searchPayloadChanged = changedFiles.some((file) =>
    file === 'language-server/src/api_search.ts'
    || file === 'extension/src/apiRequests.ts'
    || file === 'extension/src/angelscriptApiSearch.ts'
    || file === 'extension/src/toolRegistry.ts'
    || file === 'extension/src/toolShared.ts'
    || file === 'language-server/src/server.ts'
);

const docsLikelyNeedRefresh = (schemaChanged || activationChanged || searchPayloadChanged) && docsChanges.length === 0;

console.log('Fork merge smoke report');
console.log(`Base ref: ${baseRef}`);
console.log(`Changed files: ${changedFiles.length}`);

printSection('High-conflict core files', highConflictChanges);
printSection('Boundary-layer files', boundaryChanges);
printSection('Contract-sensitive files', contractChanges);
printSection('Docs files', docsChanges);

console.log('\nChecklist');
console.log(`- tool schema changed: ${schemaChanged ? 'yes' : 'no'}`);
console.log(`- activation/config changed: ${activationChanged ? 'yes' : 'no'}`);
console.log(`- search/request payload changed: ${searchPayloadChanged ? 'yes' : 'no'}`);
console.log(`- docs refresh likely needed: ${docsLikelyNeedRefresh ? 'yes' : 'no'}`);

console.log('\nRecommended commands');
console.log('- npm run test:fork-boundary');
console.log(`- npm run merge:smoke -- --base ${baseRef}`);
console.log('- npm run merge:dry-run:upstream');
