import { LANGUAGE_SERVER_TIMEOUTS_MS } from './languageServerTimeouts';

export type TimeoutHandle = ReturnType<typeof setTimeout>;

export type UnrealReconnectTimerApi = {
    setTimeout: (callback: () => void, delayMs: number) => TimeoutHandle;
    clearTimeout: (handle: TimeoutHandle) => void;
};

export type UnrealReconnectScheduler = {
    schedule: () => void;
    cancel: () => void;
    hasPending: () => boolean;
};

export function createUnrealReconnectScheduler(
    reconnect: () => void,
    isAllowed: () => boolean,
    delayMs: number = LANGUAGE_SERVER_TIMEOUTS_MS.unrealReconnectDelay,
    timerApi: UnrealReconnectTimerApi = {
        setTimeout: (callback, delay) => setTimeout(callback, delay),
        clearTimeout: (handle) => clearTimeout(handle),
    },
) : UnrealReconnectScheduler
{
    if (!Number.isFinite(delayMs) || delayMs < 0)
        throw new Error('Unreal reconnect delay must be a non-negative finite number.');
    let pending: TimeoutHandle | null = null;

    function schedule() : void
    {
        if (pending || !isAllowed())
            return;
        pending = timerApi.setTimeout(() => {
            pending = null;
            if (isAllowed())
                reconnect();
        }, delayMs);
    }

    function cancel() : void
    {
        if (!pending)
            return;
        timerApi.clearTimeout(pending);
        pending = null;
    }

    return { schedule, cancel, hasPending: () => pending != null };
}
