import { EditorListenerIdentityResult } from './editorListenerIdentity';

type IdentityFailure = Extract<EditorListenerIdentityResult, { ok: false }>;

// Retain an incident across preflight successes: only a verified connection or
// an absent listener ends it, so postflight failures cannot flood retries.
export class EditorConnectionWarnings
{
    private previous: IdentityFailure | undefined;

    constructor(private warn: (reason: string) => void) {}

    report(failure: IdentityFailure) : void
    {
        if (failure.code == 'no-listener')
        {
            this.previous = undefined;
            return;
        }
        if (this.previous?.code == failure.code && this.previous.reason == failure.reason)
            return;
        this.previous = failure;
        this.warn(failure.reason);
    }

    reset() : void
    {
        this.previous = undefined;
    }
}
