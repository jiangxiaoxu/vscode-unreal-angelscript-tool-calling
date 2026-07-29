export type PerSocketRequestScheduler<TSocket extends object> = {
    schedule: (socket: TSocket, delayMs: number, isAllowed: () => boolean, send: () => void) => void;
    cancel: (socket: TSocket) => void;
    cancelAll: () => void;
};

export function createPerSocketRequestScheduler<TSocket extends object>() : PerSocketRequestScheduler<TSocket>
{
    let timers = new Map<TSocket, NodeJS.Timeout>();

    function cancel(socket: TSocket) : void
    {
        let timer = timers.get(socket);
        if (timer)
            clearTimeout(timer);
        timers.delete(socket);
    }

    function schedule(socket: TSocket, delayMs: number, isAllowed: () => boolean, send: () => void) : void
    {
        cancel(socket);
        let timer = setTimeout(() => {
            timers.delete(socket);
            if (isAllowed())
                send();
        }, delayMs);
        timers.set(socket, timer);
    }

    function cancelAll() : void
    {
        for (let socket of timers.keys())
            cancel(socket);
    }

    return { schedule, cancel, cancelAll };
}
