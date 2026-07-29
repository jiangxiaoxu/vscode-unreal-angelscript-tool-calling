export type DebouncedPublication = {
    schedule: (generation: number, publish: () => void) => void;
    cancel: () => void;
};

export function createDebouncedPublication(delayMs = 250) : DebouncedPublication
{
    let timeout: NodeJS.Timeout | null = null;
    let scheduledGeneration = -1;
    function cancel() : void
    {
        if (timeout)
        {
            clearTimeout(timeout);
            timeout = null;
        }
        scheduledGeneration = -1;
    }
    function schedule(generation: number, publish: () => void) : void
    {
        cancel();
        scheduledGeneration = generation;
        timeout = setTimeout(() => {
            timeout = null;
            if (scheduledGeneration != generation)
                return;
            scheduledGeneration = -1;
            publish();
        }, delayMs);
    }
    return { schedule, cancel };
}
