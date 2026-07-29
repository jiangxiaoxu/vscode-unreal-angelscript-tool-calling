export type ConnectionAttemptToken = Readonly<{ generation: number }>;

export type ConnectionAttemptFence = {
    begin: () => ConnectionAttemptToken;
    isCurrent: (token: ConnectionAttemptToken) => boolean;
    complete: (token: ConnectionAttemptToken) => void;
    cancel: () => void;
    hasActive: () => boolean;
};

export function createConnectionAttemptFence() : ConnectionAttemptFence
{
    let generation = 0;
    let active: ConnectionAttemptToken | null = null;
    return {
        begin() {
            if (active)
                throw new Error('A connection attempt is already active.');
            active = Object.freeze({ generation: ++generation });
            return active;
        },
        isCurrent: (token) => active === token,
        complete(token) {
            if (active === token)
                active = null;
        },
        cancel() {
            generation += 1;
            active = null;
        },
        hasActive: () => active != null,
    };
}
