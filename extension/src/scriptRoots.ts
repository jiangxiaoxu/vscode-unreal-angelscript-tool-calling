import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export function resolveScriptRoot(workspaceRootPath : string) : string | null
{
    if (!workspaceRootPath)
        return null;

    let normalizedWorkspaceRoot = path.normalize(workspaceRootPath);
    let rootName = path.basename(normalizedWorkspaceRoot).toLowerCase();
    if (rootName == 'script')
        return normalizedWorkspaceRoot;

    let candidatePath = path.join(normalizedWorkspaceRoot, 'Script');
    try
    {
        let stat = fs.statSync(candidatePath);
        if (stat.isDirectory())
            return candidatePath;
    }
    catch
    {
    }

    return null;
}

export function createScriptFileEventWatchers(workspaceFolders : readonly vscode.WorkspaceFolder[] | undefined) : vscode.FileSystemWatcher[]
{
    if (!workspaceFolders || workspaceFolders.length == 0)
        return [];

    let watchers : vscode.FileSystemWatcher[] = [];
    let seenRoots = new Set<string>();

    for (let workspaceFolder of workspaceFolders)
    {
        let scriptRoot = resolveScriptRoot(workspaceFolder.uri.fsPath);
        if (!scriptRoot)
            continue;

        let normalizedScriptRoot = path.normalize(scriptRoot);
        let dedupeKey = process.platform == 'win32' ? normalizedScriptRoot.toLowerCase() : normalizedScriptRoot;
        if (seenRoots.has(dedupeKey))
            continue;

        seenRoots.add(dedupeKey);
        watchers.push(vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(normalizedScriptRoot, '**/*.as')));
    }

    return watchers;
}
