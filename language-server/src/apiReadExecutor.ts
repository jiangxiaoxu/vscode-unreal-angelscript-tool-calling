import { ResponseError } from 'vscode-languageserver/node';
import * as api_docs from './api_docs';
import * as api_search from './api_search';

export const API_READ_OPERATIONS = [
    'angelscript/getAPI',
    'angelscript/getAPISearch',
    'angelscript/getAPIDetails',
    'angelscript/getAPIDetailsBatch',
    'angelscript/queryAPI',
    'angelscript/readAPISymbol',
    'angelscript/getAPISymbolMembers',
    'angelscript/getAPIClassHierarchy',
] as const;

export type ApiReadOperation = typeof API_READ_OPERATIONS[number];

export function isApiReadOperation(value: unknown) : value is ApiReadOperation
{
    return typeof value == 'string' && (API_READ_OPERATIONS as readonly string[]).includes(value);
}

export function executeApiReadOperation(operation: ApiReadOperation, params: unknown) : unknown
{
    try
    {
        switch (operation)
        {
            case 'angelscript/getAPI':
                return api_docs.GetAPIList(typeof params == 'string' ? params : '');
            case 'angelscript/getAPISearch':
                return api_search.GetAPISearch(params);
            case 'angelscript/getAPIDetails':
                return api_docs.GetAPIDetails(params);
            case 'angelscript/getAPIDetailsBatch':
                return api_docs.GetAPIDetailsBatch(Array.isArray(params) ? params : []);
            case 'angelscript/queryAPI':
                return api_search.GetAPIQuery(params as api_search.GetAPIQueryParams);
            case 'angelscript/readAPISymbol':
                return api_search.GetAPIExactSymbols(params as api_search.GetAPIExactSymbolsParams);
            case 'angelscript/getAPISymbolMembers':
                return api_docs.GetAPISymbolMembers(params as api_docs.GetAPISymbolMembersParams);
            case 'angelscript/getAPIClassHierarchy':
                return api_docs.GetAPIClassHierarchy(params as api_docs.GetAPIClassHierarchyParams);
        }
    }
    catch (error)
    {
        if (error instanceof ResponseError)
            throw error;
        if (error instanceof api_search.ApiSearchValidationError
            || (error instanceof Error && error.name == 'ApiSearchValidationError'))
            throw new ResponseError<void>(0, error.message);
        throw error;
    }
}
