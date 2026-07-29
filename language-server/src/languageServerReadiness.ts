export type LanguageServerReadinessStage = 'starting' | 'loading-cache' | 'parsing' | 'resolving' | 'ready' | 'partial' | 'stopping';

export type LanguageServerDiagnosticsStatus = {
    generation: number;
    semanticGeneration: number;
    settledSemanticGeneration: number;
    stage: LanguageServerReadinessStage;
    fullReady: boolean;
    coverage: 'full' | 'partial' | 'none';
    unrealOnline: boolean;
    unrealConnected: boolean;
    editorProcessId?: number;
    editorIdentityVerification?: 'pending' | 'verified' | 'unsupported-platform' | 'rejected';
    cacheState: 'not-checked' | 'disabled' | 'missing' | 'rejected' | 'clean' | 'dirty' | 'publishing' | 'error';
    cacheDirty: boolean;
    persistenceAttempt: number;
    cacheMessage?: string;
    lastPersistenceError?: string;
    activeRevision?: string;
    persistedRevision?: string;
};

export type LanguageServerReadinessController = {
    snapshot: () => LanguageServerDiagnosticsStatus;
    update: (patch: Partial<LanguageServerDiagnosticsStatus>) => void;
    markFullReady: () => void;
    markPartialReady: (reason?: string, settleSemantics?: boolean) => void;
    beginRefresh: (generation: number) => void;
    beginSemanticRefresh: () => number;
};

export function createLanguageServerReadinessController(
    notify: (status: LanguageServerDiagnosticsStatus) => void
) : LanguageServerReadinessController
{
    let status: LanguageServerDiagnosticsStatus = {
        generation: 0,
        semanticGeneration: 0,
        settledSemanticGeneration: 0,
        stage: 'starting',
        fullReady: false,
        coverage: 'none',
        unrealOnline: false,
        unrealConnected: false,
        editorProcessId: undefined,
        cacheState: 'not-checked',
        cacheDirty: false,
        persistenceAttempt: 0,
    };
    function snapshot() : LanguageServerDiagnosticsStatus
    {
        return { ...status };
    }
    function update(patch: Partial<LanguageServerDiagnosticsStatus>) : void
    {
        let next = { ...status, ...patch };
        if (next.semanticGeneration < status.semanticGeneration)
            throw new Error('Semantic generation cannot move backwards.');
        if (next.settledSemanticGeneration < status.settledSemanticGeneration)
            throw new Error('Settled semantic generation cannot move backwards.');
        if (next.settledSemanticGeneration > next.semanticGeneration)
            throw new Error('Settled semantic generation cannot exceed the active semantic generation.');
        if (next.fullReady && next.semanticGeneration != next.settledSemanticGeneration)
            throw new Error('Full readiness requires a settled semantic generation.');
        status = next;
        notify(snapshot());
    }
    function markFullReady() : void
    {
        update({
            stage: 'ready',
            fullReady: true,
            coverage: 'full',
            settledSemanticGeneration: status.semanticGeneration,
        });
    }
    function markPartialReady(reason?: string, settleSemantics = true) : void
    {
        update({
            stage: 'partial',
            fullReady: false,
            coverage: 'partial',
            ...(settleSemantics
                ? { settledSemanticGeneration: status.semanticGeneration }
                : {}),
            ...(reason ? { cacheMessage: reason } : {}),
        });
    }
    function beginRefresh(generation: number) : void
    {
        update({
            generation,
            semanticGeneration: status.semanticGeneration + 1,
            stage: 'loading-cache',
            fullReady: false,
            coverage: 'none',
            cacheMessage: undefined,
            activeRevision: undefined,
        });
    }
    function beginSemanticRefresh() : number
    {
        let semanticGeneration = status.semanticGeneration + 1;
        update({
            semanticGeneration,
            stage: 'parsing',
            fullReady: false,
            coverage: 'none',
        });
        return semanticGeneration;
    }
    return { snapshot, update, markFullReady, markPartialReady, beginRefresh, beginSemanticRefresh };
}
