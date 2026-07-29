export type LanguageServerReadinessStage = 'starting' | 'loading-cache' | 'parsing' | 'resolving' | 'ready' | 'partial' | 'stopping';

export type LanguageServerDiagnosticsStatus = {
    generation: number;
    stage: LanguageServerReadinessStage;
    fullReady: boolean;
    coverage: 'full' | 'partial' | 'none';
    unrealOnline: boolean;
    unrealConnected: boolean;
    cache: 'not-checked' | 'loaded' | 'missing' | 'rejected' | 'published';
    cacheReason?: string;
    revision?: string;
};

export type LanguageServerReadinessController = {
    snapshot: () => LanguageServerDiagnosticsStatus;
    update: (patch: Partial<LanguageServerDiagnosticsStatus>) => void;
    markFullReady: () => void;
    markPartialReady: (reason?: string) => void;
    beginRefresh: (generation: number) => void;
};

export function createLanguageServerReadinessController(
    notify: (status: LanguageServerDiagnosticsStatus) => void
) : LanguageServerReadinessController
{
    let status: LanguageServerDiagnosticsStatus = {
        generation: 0,
        stage: 'starting',
        fullReady: false,
        coverage: 'none',
        unrealOnline: false,
        unrealConnected: false,
        cache: 'not-checked',
    };
    function snapshot() : LanguageServerDiagnosticsStatus
    {
        return { ...status };
    }
    function update(patch: Partial<LanguageServerDiagnosticsStatus>) : void
    {
        status = { ...status, ...patch };
        notify(snapshot());
    }
    function markFullReady() : void
    {
        update({ stage: 'ready', fullReady: true, coverage: 'full' });
    }
    function markPartialReady(reason?: string) : void
    {
        update({ stage: 'partial', fullReady: false, coverage: 'partial', ...(reason ? { cacheReason: reason } : {}) });
    }
    function beginRefresh(generation: number) : void
    {
        update({
            generation,
            stage: 'loading-cache',
            fullReady: false,
            coverage: 'none',
            cache: 'not-checked',
            cacheReason: undefined,
            revision: undefined,
        });
    }
    return { snapshot, update, markFullReady, markPartialReady, beginRefresh };
}
