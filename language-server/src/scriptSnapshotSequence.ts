import { CancellationToken, LSPErrorCodes, ResponseError } from 'vscode-languageserver/node';

export type ScriptSnapshotIdentity = {
    scriptSequence: number;
    scriptRevision: string;
};

export type ScriptSnapshotSequenceSnapshot = {
    accepted?: ScriptSnapshotIdentity;
    settled?: ScriptSnapshotIdentity;
    closed: boolean;
};

export type ScriptSnapshotSequenceController = {
    accept: (identity: ScriptSnapshotIdentity) => void;
    markUnsettled: () => void;
    markSettled: () => ScriptSnapshotIdentity | undefined;
    waitForSettled: (minimumScriptSequence: number, cancellationToken?: CancellationToken) => Promise<ScriptSnapshotIdentity>;
    snapshot: () => ScriptSnapshotSequenceSnapshot;
    shutdown: () => void;
};

type Waiter = {
    minimumScriptSequence: number;
    resolve: (identity: ScriptSnapshotIdentity) => void;
    reject: (error: ResponseError<void>) => void;
    cancellation?: { dispose: () => void };
};

const SCRIPT_SNAPSHOT_PROTOCOL_ERROR_CODE = -32020;

function cloneIdentity(identity: ScriptSnapshotIdentity) : ScriptSnapshotIdentity
{
    return {
        scriptSequence: identity.scriptSequence,
        scriptRevision: identity.scriptRevision,
    };
}

export function createScriptSnapshotSequenceController() : ScriptSnapshotSequenceController
{
    let accepted: ScriptSnapshotIdentity | undefined;
    let settled: ScriptSnapshotIdentity | undefined;
    let closed = false;
    let waiters = new Set<Waiter>();

    function protocolError(message: string) : ResponseError<void>
    {
        return new ResponseError<void>(SCRIPT_SNAPSHOT_PROTOCOL_ERROR_CODE, message);
    }

    function resolveEligibleWaiters() : void
    {
        if (!accepted || !settled || accepted.scriptSequence != settled.scriptSequence
            || accepted.scriptRevision != settled.scriptRevision)
            return;
        for (let waiter of Array.from(waiters))
        {
            if (waiter.minimumScriptSequence > settled.scriptSequence)
                continue;
            waiters.delete(waiter);
            waiter.cancellation?.dispose();
            waiter.resolve(cloneIdentity(settled));
        }
    }

    return {
        accept(identity)
        {
            if (closed)
                throw protocolError('Script snapshot protocol is stopping.');
            accepted = cloneIdentity(identity);
            resolveEligibleWaiters();
        },
        markUnsettled()
        {
            if (closed || !accepted)
                return;
            settled = undefined;
        },
        markSettled()
        {
            if (closed || !accepted)
                return undefined;
            settled = cloneIdentity(accepted);
            resolveEligibleWaiters();
            return cloneIdentity(settled);
        },
        async waitForSettled(minimumScriptSequence, cancellationToken)
        {
            if (closed)
                throw protocolError('Script snapshot protocol is stopping.');
            if (cancellationToken?.isCancellationRequested)
            {
                throw new ResponseError<void>(
                    LSPErrorCodes.RequestCancelled,
                    'Script snapshot request was cancelled while waiting for a settled script sequence.',
                );
            }
            if (!accepted)
                throw protocolError('No script snapshot has been accepted for this Language Server instance.');
            if (minimumScriptSequence > accepted.scriptSequence)
            {
                throw protocolError(
                    `Requested script sequence ${minimumScriptSequence} exceeds accepted sequence ${accepted.scriptSequence}.`,
                );
            }
            if (settled && settled.scriptSequence == accepted.scriptSequence
                && settled.scriptRevision == accepted.scriptRevision
                && minimumScriptSequence <= settled.scriptSequence)
                return cloneIdentity(settled);

            return new Promise<ScriptSnapshotIdentity>((resolve, reject) => {
                let waiter: Waiter = {
                    minimumScriptSequence,
                    resolve,
                    reject,
                };
                let cancel = () => {
                    if (!waiters.delete(waiter))
                        return;
                    waiter.cancellation?.dispose();
                    reject(new ResponseError<void>(
                        LSPErrorCodes.RequestCancelled,
                        'Script snapshot request was cancelled while waiting for a settled script sequence.',
                    ));
                };
                waiter.cancellation = cancellationToken?.onCancellationRequested(cancel);
                if (cancellationToken?.isCancellationRequested)
                {
                    cancel();
                    return;
                }
                waiters.add(waiter);
                resolveEligibleWaiters();
            });
        },
        snapshot()
        {
            return {
                ...(accepted ? { accepted: cloneIdentity(accepted) } : {}),
                ...(settled ? { settled: cloneIdentity(settled) } : {}),
                closed,
            };
        },
        shutdown()
        {
            if (closed)
                return;
            closed = true;
            for (let waiter of Array.from(waiters))
            {
                waiters.delete(waiter);
                waiter.cancellation?.dispose();
                waiter.reject(protocolError('Script snapshot protocol is stopping.'));
            }
        },
    };
}
