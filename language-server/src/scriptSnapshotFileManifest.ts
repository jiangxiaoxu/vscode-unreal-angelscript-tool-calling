import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { URI } from 'vscode-uri';
import glob from 'glob';
import type {
    ScriptSnapshotChange,
    ScriptSnapshotManifestEntry,
    ValidatedScriptSnapshotContent,
} from './scriptSnapshotProtocol';
import type { ScriptSnapshotIdentity } from './scriptSnapshotSequence';

export type ScriptSnapshotFileManifestConfiguration = {
    scriptRoots: readonly string[];
    ignorePatterns: readonly string[];
    isManagedScriptUri: (uri: string) => boolean;
};

export type ScriptSnapshotFileManifestValidator = {
    configure: (configuration: ScriptSnapshotFileManifestConfiguration) => void;
    validate: (
        mode: 'full' | 'diff',
        manifest: readonly ScriptSnapshotManifestEntry[],
        changes: readonly ScriptSnapshotChange[],
        identity: ScriptSnapshotIdentity,
    ) => ValidatedScriptSnapshotContent;
};

export function createScriptSnapshotFileManifestValidator() : ScriptSnapshotFileManifestValidator
{
    let configuration: ScriptSnapshotFileManifestConfiguration | undefined;

    function configured() : ScriptSnapshotFileManifestConfiguration
    {
        if (!configuration)
            throw new Error('Script snapshot file manifest validator is not configured.');
        return configuration;
    }

    return {
        configure(next)
        {
            configuration = {
                scriptRoots: [...next.scriptRoots],
                ignorePatterns: [...next.ignorePatterns],
                isManagedScriptUri: next.isManagedScriptUri,
            };
        },
        validate(mode, manifest, changes, _identity)
        {
            let current = configured();
            let content = new Map<string, Uint8Array>();
            let manifestByUri = new Map(manifest.map((entry) => [entry.uri, entry]));
            for (let entry of manifest)
            {
                if (!current.isManagedScriptUri(entry.uri))
                    throw new Error(`Script snapshot manifest URI is outside configured Script roots: ${entry.uri}`);
            }
            if (mode == 'diff')
            {
                for (let change of changes)
                {
                    if (change.kind == 'deleted' && existsSync(URI.parse(change.uri).fsPath))
                        throw new Error(`Deleted script snapshot file still exists: ${change.uri}`);
                }
            }
            let entries = mode == 'full'
                ? manifest.map((entry) => ({ uri: entry.uri, hash: entry.hash }))
                : changes
                    .filter((change) => change.kind != 'deleted')
                    .map((change) => ({ uri: change.uri, hash: change.hash! }));
            for (let entry of entries)
            {
                let bytes: Buffer;
                try { bytes = readFileSync(URI.parse(entry.uri).fsPath); }
                catch (error)
                {
                    throw new Error(`Cannot read accepted script snapshot file ${entry.uri}: ${String(error)}`);
                }
                let actualHash = createHash('sha256').update(bytes).digest('hex');
                if (actualHash != entry.hash)
                {
                    throw new Error(
                        `Accepted script snapshot hash mismatch for ${entry.uri}: expected ${entry.hash}, actual ${actualHash}.`,
                    );
                }
                content.set(entry.uri, bytes);
            }
            if (mode == 'full')
            {
                let actualUris = new Set<string>();
                for (let scriptRoot of current.scriptRoots)
                {
                    for (let filePath of glob.sync(path.join(scriptRoot, '**', '*.[aA][sS]'), { ignore: current.ignorePatterns }))
                        actualUris.add(URI.file(path.resolve(filePath)).toString());
                }
                for (let uri of actualUris)
                {
                    if (!manifestByUri.has(uri))
                        throw new Error(`Full script snapshot omitted managed script ${uri}.`);
                }
                for (let uri of manifestByUri.keys())
                {
                    if (!actualUris.has(uri))
                        throw new Error(`Full script snapshot references missing managed script ${uri}.`);
                }
            }
            return content;
        },
    };
}
