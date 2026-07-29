import * as fs from 'node:fs';
import * as path from 'node:path';

export type WorkspaceProjectIdentity =
    | {
        ok: true;
        canonicalProjectRoot: string;
        uprojectPath: string;
        projectIdentity: string;
    }
    | {
        ok: false;
        reason: string;
    };

function canonicalPath(candidate: string) : string
{
    return path.normalize(fs.realpathSync.native(candidate));
}

function identityKey(candidate: string) : string
{
    let normalized = path.normalize(candidate);
    return process.platform == 'win32' ? normalized.toLowerCase() : normalized;
}

function projectRootCandidate(workspacePath: string) : string
{
    let canonicalWorkspace = canonicalPath(workspacePath);
    return path.basename(canonicalWorkspace).toLowerCase() == 'script'
        ? path.dirname(canonicalWorkspace)
        : canonicalWorkspace;
}

export function resolveWorkspaceProjectIdentity(workspacePaths: readonly string[]) : WorkspaceProjectIdentity
{
    let projects = new Map<string, { canonicalProjectRoot: string; uprojectPath: string }>();
    for (let workspacePath of workspacePaths)
    {
        let projectRoot: string;
        try { projectRoot = projectRootCandidate(workspacePath); }
        catch { continue; }

        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(projectRoot, { withFileTypes: true }); }
        catch { continue; }
        for (let entry of entries)
        {
            if (!entry.isFile() || path.extname(entry.name).toLowerCase() != '.uproject')
                continue;
            let uprojectPath: string;
            try { uprojectPath = canonicalPath(path.join(projectRoot, entry.name)); }
            catch { continue; }
            projects.set(identityKey(uprojectPath), { canonicalProjectRoot: projectRoot, uprojectPath });
        }
    }

    if (projects.size != 1)
    {
        return {
            ok: false,
            reason: projects.size == 0
                ? 'No unique physical .uproject could be resolved from the workspace.'
                : `Workspace resolves to ${projects.size} physical .uproject files.`,
        };
    }
    let project = projects.values().next().value!;
    return {
        ok: true,
        ...project,
        projectIdentity: identityKey(project.uprojectPath),
    };
}
