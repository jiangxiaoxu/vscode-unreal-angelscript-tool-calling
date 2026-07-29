export type ActiveWorkTracker = {
    begin: () => () => void;
    hasActiveWork: () => boolean;
};

export function createActiveWorkTracker(onDrained: () => void) : ActiveWorkTracker
{
    let activeCount = 0;
    function begin() : () => void
    {
        activeCount += 1;
        let finished = false;
        return () => {
            if (finished)
                throw new Error('Active work completion may only be reported once.');
            finished = true;
            activeCount -= 1;
            if (activeCount == 0)
                onDrained();
        };
    }
    return {
        begin,
        hasActiveWork: () => activeCount != 0,
    };
}
