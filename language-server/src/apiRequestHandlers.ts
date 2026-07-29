import { Connection, ResponseError } from 'vscode-languageserver/node';
import * as typedb from './database';
import * as api_docs from './api_docs';
import * as api_search from './api_search';

export type ApiRequestHandlerDeps = {
    connection: Connection;
    isUnrealConnected: () => boolean;
    getFullReadyStatus?: () => { fullReady: boolean; stage: string; coverage: string };
    exportApiQueryIndex?: () => unknown | Promise<unknown>;
    typesReadyWait?: {
        maxTries?: number;
        delayMs?: number;
    };
};

const API_TYPES_NOT_READY_ERROR_CODE = -32002;

function runWhenTypesReady<T>(
    run : () => T,
    options: {
        maxTries?: number;
        delayMs?: number;
        isReady?: () => boolean;
        isTerminalNotReady?: () => boolean;
        describeNotReady?: () => string;
    } = {}
) : T | ResponseError<void> | Promise<T | ResponseError<void>>
{
    let isReady = options.isReady ?? (() => typedb.HasTypesFromUnreal());
    if (isReady())
        return run();
    if (options.isTerminalNotReady?.())
    {
        return new ResponseError<void>(
            API_TYPES_NOT_READY_ERROR_CODE,
            options.describeNotReady?.() ?? 'NotReady: AngelScript API types are not ready.'
        );
    }

    let maxTries = options.maxTries ?? 50;
    let delayMs = options.delayMs ?? 100;

    function timerFunc(resolve : (value: T | ResponseError<void>) => void, reject : (reason?: unknown) => void, triesLeft : number)
    {
        if (isReady())
        {
            try
            {
                return resolve(run());
            }
            catch (error)
            {
                reject(error);
                return;
            }
        }
        if (options.isTerminalNotReady?.())
        {
            resolve(new ResponseError<void>(
                API_TYPES_NOT_READY_ERROR_CODE,
                options.describeNotReady?.() ?? 'NotReady: AngelScript API types are not ready.'
            ));
            return;
        }
        if (triesLeft <= 0)
        {
            resolve(new ResponseError<void>(
                API_TYPES_NOT_READY_ERROR_CODE,
                options.describeNotReady?.() ?? 'NotReady: AngelScript API types are not ready.'
            ));
            return;
        }
        setTimeout(function() { timerFunc(resolve, reject, triesLeft - 1); }, delayMs);
    }

    return new Promise<T | ResponseError<void>>(function(resolve, reject)
    {
        timerFunc(resolve, reject, maxTries);
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
    const runReady = <T>(run: () => T) => runWhenTypesReady(run, {
        ...deps.typesReadyWait,
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

    connection.onRequest("angelscript/getAPI", (root : string) : any => {
        return runReady(() => api_docs.GetAPIList(root));
    });

    connection.onRequest("angelscript/getAPISearch", (payload : any) : any => {
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

        return runReady(runSearch);
    });

    connection.onRequest("angelscript/getAPIDetails", (root : any) : any => {
        return runReady(() => api_docs.GetAPIDetails(root));
    });

    connection.onRequest("angelscript/getAPIDetailsBatch", (roots : any) : any => {
        let dataList = Array.isArray(roots) ? roots : [];
        return runReady(() => api_docs.GetAPIDetailsBatch(dataList));
    });

    connection.onRequest("angelscript/queryAPI", (params : api_search.GetAPIQueryParams) : any => {
        return runReady(() => runApiCoreRequest(() => api_search.GetAPIQuery(params)));
    });

    connection.onRequest("angelscript/readAPISymbol", (params : api_search.GetAPIExactSymbolsParams) : any => {
        return runReady(() => runApiCoreRequest(() => api_search.GetAPIExactSymbols(params)));
    });

    connection.onRequest("angelscript/getAPISymbolMembers", (params : api_docs.GetAPISymbolMembersParams) : any => {
        return runReady(() => runApiCoreRequest(() => api_docs.GetAPISymbolMembers(params)));
    });

    connection.onRequest("angelscript/getAPIClassHierarchy", (params : api_docs.GetAPIClassHierarchyParams) : any => {
        return runReady(() => runApiCoreRequest(() => api_docs.GetAPIClassHierarchy(params)));
    });

    connection.onRequest("angelscript/exportApiQueryIndex", () : any => {
        if (!deps.exportApiQueryIndex)
            return new ResponseError<void>(-32601, 'API query index export is not configured.');
        return runReady(() => deps.exportApiQueryIndex());
    });
}
