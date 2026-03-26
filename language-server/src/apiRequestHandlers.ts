import { Connection, Location, ResponseError } from 'vscode-languageserver/node';
import * as scriptfiles from './as_parser';
import * as scriptsymbols from './symbols';
import * as typedb from './database';
import * as api_docs from './api_docs';
import * as api_search from './api_search';

export type ApiRequestHandlerDeps = {
    connection: Connection;
    getAndParseModule: (uri: string) => scriptfiles.ASModule;
    getModuleName: (uri: string) => string;
    isUnrealConnected: () => boolean;
};

function runWhenTypesReady<T>(run : () => T) : T | Promise<T>
{
    if (typedb.HasTypesFromUnreal())
        return run();

    function timerFunc(resolve : any, reject : any, triesLeft : number)
    {
        if (typedb.HasTypesFromUnreal())
            return resolve(run());
        setTimeout(function() { timerFunc(resolve, reject, triesLeft - 1); }, 100);
    }

    return new Promise<T>(function(resolve, reject)
    {
        timerFunc(resolve, reject, 50);
    });
}

export function registerApiRequestHandlers(deps : ApiRequestHandlerDeps) : void
{
    const { connection, getAndParseModule, isUnrealConnected } = deps;

    connection.onRequest("angelscript/getUnrealConnectionStatus", () : boolean => {
        return isUnrealConnected();
    });

    connection.onRequest("angelscript/resolveSymbolAtPosition", (params : scriptsymbols.ResolveSymbolAtPositionParams) : scriptsymbols.ResolveSymbolAtPositionResult => {
        if (!params || !params.uri || !params.position)
            return { ok: false, error: { code: "InvalidParams", message: "uri and position are required." } };

        let asmodule = getAndParseModule(params.uri);
        if (!asmodule)
            return { ok: false, error: { code: "NotFound", message: "Module not found." } };

        return scriptsymbols.ResolveSymbolAtPosition(asmodule, params.position, params.includeDocumentation !== false);
    });

    connection.onRequest("angelscript/getAPI", (root : string) : any => {
        return runWhenTypesReady(() => api_docs.GetAPIList(root));
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

        return runWhenTypesReady(runSearch);
    });

    connection.onRequest("angelscript/getAPIDetails", (root : any) : any => {
        return runWhenTypesReady(() => api_docs.GetAPIDetails(root));
    });

    connection.onRequest("angelscript/getAPIDetailsBatch", (roots : any) : any => {
        let dataList = Array.isArray(roots) ? roots : [];
        return runWhenTypesReady(() => api_docs.GetAPIDetailsBatch(dataList));
    });

    connection.onRequest("angelscript/getTypeMembers", (params : any) : any => {
        return runWhenTypesReady(() => api_docs.GetTypeMembers(params));
    });

    connection.onRequest("angelscript/getTypeHierarchy", (params : any) : any => {
        return runWhenTypesReady(() => api_docs.GetTypeHierarchy(params));
    });
}
