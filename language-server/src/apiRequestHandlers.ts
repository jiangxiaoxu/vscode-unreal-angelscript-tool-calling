import { CancellationToken, Connection, LSPErrorCodes, ResponseError } from 'vscode-languageserver/node';
import * as typedb from './database';
import * as api_docs from './api_docs';
import * as api_search from './api_search';
import { LANGUAGE_SERVER_TIMEOUTS_MS } from './languageServerTimeouts';
import { performance } from 'node:perf_hooks';

type TypesReadyWaitOptions = {
    timeoutMs?: number;
    pollIntervalMs?: number;
    now?: () => number;
    wait?: (delayMs: number, cancellationToken?: CancellationToken) => Promise<boolean>;
};

export type ApiRequestHandlerDeps = {
    connection: Connection;
    isUnrealConnected: () => boolean;
    getFullReadyStatus?: () => { fullReady: boolean; stage: string; coverage: string };
    typesReadyWait?: TypesReadyWaitOptions;
};

const API_TYPES_NOT_READY_ERROR_CODE = -32002;

function runWhenTypesReady<T>(
    run : () => T,
    options: TypesReadyWaitOptions & {
        isReady?: () => boolean;
        isTerminalNotReady?: () => boolean;
        describeNotReady?: () => string;
        cancellationToken?: CancellationToken;
    } = {}
) : T | ResponseError<void> | Promise<T | ResponseError<void>>
{
    let isReady = options.isReady ?? (() => typedb.HasTypesFromUnreal());
    let notReady = () => new ResponseError<void>(
        API_TYPES_NOT_READY_ERROR_CODE,
        options.describeNotReady?.() ?? 'NotReady: AngelScript API types are not ready.'
    );
    let cancelled = () => new ResponseError<void>(
        LSPErrorCodes.RequestCancelled,
        'AngelScript API request was cancelled while waiting for full readiness.'
    );
    if (options.cancellationToken?.isCancellationRequested)
        return cancelled();
    if (isReady())
        return run();
    if (options.isTerminalNotReady?.())
        return notReady();

    let timeoutMs = options.timeoutMs ?? LANGUAGE_SERVER_TIMEOUTS_MS.apiFullReadyWait;
    let pollIntervalMs = options.pollIntervalMs ?? LANGUAGE_SERVER_TIMEOUTS_MS.apiFullReadyPoll;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
        throw new Error('API full-ready wait timeout must be a non-negative finite number.');
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0)
        throw new Error('API full-ready poll interval must be a positive finite number.');
    let now = options.now ?? (() => performance.now());
    let wait = options.wait ?? waitForDelayOrCancellation;
    let deadline = now() + timeoutMs;

    return (async () => {
        while (true)
        {
            if (options.cancellationToken?.isCancellationRequested)
                return cancelled();
            let remainingMs = deadline - now();
            if (remainingMs <= 0)
                return notReady();
            if (isReady())
                return run();
            if (options.isTerminalNotReady?.())
                return notReady();
            if (!await wait(Math.min(pollIntervalMs, remainingMs), options.cancellationToken))
                return cancelled();
        }
    })();
}

function waitForDelayOrCancellation(delayMs: number, cancellationToken?: CancellationToken) : Promise<boolean>
{
    if (cancellationToken?.isCancellationRequested)
        return Promise.resolve(false);
    return new Promise((resolve) => {
        let settled = false;
        let timer: NodeJS.Timeout | null = setTimeout(() => finish(true), delayMs);
        let cancellation = cancellationToken?.onCancellationRequested(() => finish(false));
        function finish(elapsed: boolean) : void
        {
            if (settled)
                return;
            settled = true;
            if (timer)
                clearTimeout(timer);
            timer = null;
            cancellation?.dispose();
            resolve(elapsed);
        }
        if (cancellationToken?.isCancellationRequested)
            finish(false);
    });
}

function runApiCoreRequest<T>(run: () => T) : T | ResponseError<void>
{
    try
    {
        return run();
    }
    catch (error)
    {
        if (error instanceof api_search.ApiSearchValidationError
            || (error instanceof Error && error.name == 'ApiSearchValidationError'))
            return new ResponseError<void>(0, error.message);
        throw error;
    }
}

export function registerApiRequestHandlers(deps : ApiRequestHandlerDeps) : void
{
    const { connection, isUnrealConnected } = deps;
    const runReady = <T>(run: () => T, cancellationToken?: CancellationToken) => runWhenTypesReady(run, {
        ...deps.typesReadyWait,
        cancellationToken,
        isReady: deps.getFullReadyStatus
            ? () => deps.getFullReadyStatus().fullReady
            : undefined,
        isTerminalNotReady: deps.getFullReadyStatus
            ? () => {
                let stage = deps.getFullReadyStatus().stage;
                return stage == 'partial' || stage == 'stopping';
            }
            : undefined,
        describeNotReady: deps.getFullReadyStatus
            ? () => {
                let status = deps.getFullReadyStatus();
                return `NotReady: AngelScript Language Server stage=${status.stage}, coverage=${status.coverage}.`;
            }
            : undefined,
    });

    connection.onRequest("angelscript/getUnrealConnectionStatus", () : boolean => {
        return isUnrealConnected();
    });

    connection.onRequest("angelscript/getAPI", (root : string, cancellationToken) : any => {
        return runReady(() => api_docs.GetAPIList(root), cancellationToken);
    });

    connection.onRequest("angelscript/getAPISearch", (payload : any, cancellationToken) : any => {
        let runSearch = function()
        {
            try
            {
                return api_search.GetAPISearch(payload);
            }
            catch (error)
            {
                if (error instanceof api_search.ApiSearchValidationError)
                    return new ResponseError<void>(0, error.message);
                throw error;
            }
        };

        return runReady(runSearch, cancellationToken);
    });

    connection.onRequest("angelscript/getAPIDetails", (root : any, cancellationToken) : any => {
        return runReady(() => api_docs.GetAPIDetails(root), cancellationToken);
    });

    connection.onRequest("angelscript/getAPIDetailsBatch", (roots : any, cancellationToken) : any => {
        let dataList = Array.isArray(roots) ? roots : [];
        return runReady(() => api_docs.GetAPIDetailsBatch(dataList), cancellationToken);
    });

    connection.onRequest("angelscript/queryAPI", (params : api_search.GetAPIQueryParams, cancellationToken) : any => {
        return runReady(() => runApiCoreRequest(() => api_search.GetAPIQuery(params)), cancellationToken);
    });

    connection.onRequest("angelscript/readAPISymbol", (params : api_search.GetAPIExactSymbolsParams, cancellationToken) : any => {
        return runReady(() => runApiCoreRequest(() => api_search.GetAPIExactSymbols(params)), cancellationToken);
    });

    connection.onRequest("angelscript/getAPISymbolMembers", (params : api_docs.GetAPISymbolMembersParams, cancellationToken) : any => {
        return runReady(() => runApiCoreRequest(() => api_docs.GetAPISymbolMembers(params)), cancellationToken);
    });

    connection.onRequest("angelscript/getAPIClassHierarchy", (params : api_docs.GetAPIClassHierarchyParams, cancellationToken) : any => {
        return runReady(() => runApiCoreRequest(() => api_docs.GetAPIClassHierarchy(params)), cancellationToken);
    });

}
