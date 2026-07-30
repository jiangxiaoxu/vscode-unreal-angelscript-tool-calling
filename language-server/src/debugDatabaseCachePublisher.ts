import type { DebugDatabaseCacheV2 } from './debugDatabaseCacheV2';
import { LANGUAGE_SERVER_TIMEOUTS_MS } from './languageServerTimeouts';

export type DebugDatabaseCachePublication = {
    generation: number;
    revision: string;
    publish: (isCurrent: () => boolean) => Promise<DebugDatabaseCacheV2>;
};

export type DebugDatabasePersistenceState = 'disabled' | 'missing' | 'clean' | 'dirty' | 'publishing' | 'error';

export type DebugDatabasePersistenceStatus = {
    state: DebugDatabasePersistenceState;
    cacheDirty: boolean;
    persistenceAttempt: number;
    activeRevision?: string;
    persistedRevision?: string;
    pendingRevision?: string;
    lastPersistenceError?: string;
};

export type DebugDatabaseCachePublisher = {
    setInitialState: (state: 'disabled' | 'missing' | 'clean', persistedRevision?: string) => void;
    submit: (publication: DebugDatabaseCachePublication) => void;
    snapshot: () => DebugDatabasePersistenceStatus;
    flush: (timeoutMs?: number) => Promise<boolean>;
    shutdown: (timeoutMs?: number) => Promise<boolean>;
};

export type DebugDatabaseCachePublisherOptions = {
    retryDelaysMs?: readonly number[];
    onStatus?: (status: DebugDatabasePersistenceStatus) => void;
    onPublished?: (cache: DebugDatabaseCacheV2) => void;
};

export function createDebugDatabaseCachePublisher(
    options: DebugDatabaseCachePublisherOptions = {},
) : DebugDatabaseCachePublisher
{
    let retryDelaysMs = options.retryDelaysMs ?? LANGUAGE_SERVER_TIMEOUTS_MS.cachePersistenceRetry;
    let status: DebugDatabasePersistenceStatus = { state: 'disabled', cacheDirty: false, persistenceAttempt: 0 };
    let pending: DebugDatabaseCachePublication | null = null;
    let failedLatest: DebugDatabaseCachePublication | null = null;
    let worker: Promise<void> | null = null;
    let accepting = true;
    let cancelBackoff: (() => void) | null = null;

    function publishStatus(patch: Partial<DebugDatabasePersistenceStatus>) : void
    {
        status = { ...status, ...patch };
        options.onStatus?.({ ...status });
    }

    function setInitialState(state: 'disabled' | 'missing' | 'clean', persistedRevision?: string) : void
    {
        status = {
            state,
            cacheDirty: false,
            persistenceAttempt: 0,
            ...(persistedRevision ? { activeRevision: persistedRevision, persistedRevision } : {}),
        };
        options.onStatus?.({ ...status });
    }

    function submit(publication: DebugDatabaseCachePublication) : void
    {
        if (!accepting)
        {
            failedLatest = publication;
            publishStatus({
                state: status.state == 'disabled' ? 'disabled' : 'error',
                cacheDirty: status.state != 'disabled',
                persistenceAttempt: 0,
                activeRevision: publication.revision,
                pendingRevision: status.state == 'disabled' ? undefined : publication.revision,
                lastPersistenceError: status.state == 'disabled'
                    ? undefined
                    : 'DebugDatabase cache publisher is shutting down.',
            });
            return;
        }
        cancelBackoff?.();
        failedLatest = null;
        if (status.state == 'disabled')
        {
            pending = null;
            publishStatus({
                activeRevision: publication.revision,
                pendingRevision: undefined,
                cacheDirty: false,
                persistenceAttempt: 0,
                lastPersistenceError: undefined,
            });
            return;
        }
        pending = publication;
        publishStatus({
            state: 'dirty',
            cacheDirty: true,
            persistenceAttempt: 0,
            activeRevision: publication.revision,
            pendingRevision: publication.revision,
            lastPersistenceError: undefined,
        });
        startWorker();
    }

    function startWorker() : void
    {
        if (!worker && pending)
        {
            worker = runWorker().finally(() => {
                worker = null;
                if (pending)
                    startWorker();
            });
        }
    }

    async function runWorker() : Promise<void>
    {
        while (pending)
        {
            let current = pending;
            pending = null;
            let attempt = 0;
            while (true)
            {
                publishStatus({
                    state: 'publishing',
                    cacheDirty: true,
                    persistenceAttempt: attempt + 1,
                    pendingRevision: current.revision,
                    lastPersistenceError: attempt == 0 ? undefined : status.lastPersistenceError,
                });
                try
                {
                    let published = await current.publish(
                        () => pending == null || pending.generation <= current.generation,
                    );
                    if (published.revision != current.revision)
                        throw new Error('Published cache revision does not match the submitted generation.');
                    publishStatus({
                        state: pending ? 'dirty' : 'clean',
                        cacheDirty: pending != null,
                        persistenceAttempt: attempt + 1,
                        persistedRevision: current.revision,
                        pendingRevision: pending?.revision,
                        lastPersistenceError: undefined,
                    });
                    failedLatest = null;
                    options.onPublished?.(published);
                    break;
                }
                catch (error)
                {
                    if (pending && pending.generation > current.generation)
                    {
                        publishStatus({
                            state: 'dirty',
                            cacheDirty: true,
                            pendingRevision: pending.revision,
                            lastPersistenceError: String(error),
                        });
                        break;
                    }
                    if (attempt >= retryDelaysMs.length)
                    {
                        failedLatest = current;
                        publishStatus({
                            state: 'error',
                            cacheDirty: true,
                            persistenceAttempt: attempt + 1,
                            pendingRevision: current.revision,
                            lastPersistenceError: String(error),
                        });
                        break;
                    }
                    publishStatus({
                        state: 'dirty',
                        cacheDirty: true,
                        persistenceAttempt: attempt + 1,
                        pendingRevision: current.revision,
                        lastPersistenceError: String(error),
                    });
                    let delay = retryDelaysMs[attempt++];
                    await new Promise<void>((resolve) => {
                        let timer = setTimeout(finish, delay);
                        function finish()
                        {
                            clearTimeout(timer);
                            cancelBackoff = null;
                            resolve();
                        }
                        cancelBackoff = finish;
                    });
                    if (pending && pending.generation > current.generation)
                        break;
                }
            }
        }
    }

    async function waitForWorker(timeoutMs: number) : Promise<boolean>
    {
        let deadline = Date.now() + timeoutMs;
        while (worker)
        {
            let remaining = deadline - Date.now();
            if (remaining <= 0)
                return false;
            let timedOut = false;
            await Promise.race([
                worker,
                new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, remaining)),
            ]);
            if (timedOut)
                return false;
        }
        return !pending && (status.state == 'clean' || status.state == 'disabled' || status.state == 'missing');
    }

    async function flush(timeoutMs: number = LANGUAGE_SERVER_TIMEOUTS_MS.shutdownPersistenceFlush) : Promise<boolean>
    {
        if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
            throw new Error('DebugDatabase cache flush timeout must be a non-negative finite number.');
        if (!worker && failedLatest)
        {
            pending = failedLatest;
            failedLatest = null;
            startWorker();
        }
        return waitForWorker(timeoutMs);
    }

    async function shutdown(timeoutMs: number = LANGUAGE_SERVER_TIMEOUTS_MS.shutdownPersistenceFlush) : Promise<boolean>
    {
        let flushPromise = flush(timeoutMs);
        accepting = false;
        cancelBackoff?.();
        return flushPromise;
    }

    return {
        setInitialState,
        submit,
        snapshot: () => ({ ...status }),
        flush,
        shutdown,
    };
}
