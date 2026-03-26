import { Location, Position } from 'vscode-languageserver';
import * as scriptfiles from './as_parser';
import * as parsedcompletion from './parsed_completion';
import * as typedb from './database';
import { FormatFunctionDocumentation, FormatPropertyDocumentation } from './documentation';

export interface ResolveSymbolAtPositionParams
{
    uri : string;
    position : Position;
    includeDocumentation? : boolean;
};

export interface ResolvedSymbolDefinition
{
    uri : string;
    startLine : number;
    endLine : number;
};

export interface ResolvedSymbolDoc
{
    format : "markdown" | "plaintext";
    text : string;
};

export interface ResolvedSymbolInfo
{
    kind : string;
    name : string;
    signature : string;
    definition? : ResolvedSymbolDefinition;
    doc? : ResolvedSymbolDoc;
};

export type ResolveSymbolAtPositionResult =
{
    ok : true;
    symbol : ResolvedSymbolInfo;
} |
{
    ok : false;
    error : {
        code : "NotFound" | "NotReady" | "InvalidParams" | "Unavailable";
        message : string;
        retryable? : boolean;
        hint? : string;
    };
};

type DefinitionResolver = (asmodule : scriptfiles.ASModule, position : Position) => Array<Location>;

function GetModuleUri(module : scriptfiles.ASModule) : string
{
    if (!module)
        return null;
    if (module.displayUri)
        return module.displayUri;
    return module.uri;
}

function BuildDefinitionFromOffsets(module : scriptfiles.ASModule, startOffset : number, endOffset : number) : ResolvedSymbolDefinition
{
    if (!module || startOffset < 0)
        return null;
    let uri = GetModuleUri(module);
    if (!uri)
        return null;
    let safeEnd = endOffset;
    if (safeEnd < startOffset || safeEnd < 0)
        safeEnd = startOffset;
    let startPos = module.getPosition(startOffset);
    let endPos = module.getPosition(safeEnd);
    if (startPos.line < 0)
        return null;
    let endLine = endPos.line;
    if (endLine < startPos.line)
        endLine = startPos.line;
    return {
        uri: uri,
        startLine: startPos.line,
        endLine: endLine,
    };
}

function BuildDefinitionFromLocation(location : Location) : ResolvedSymbolDefinition
{
    if (!location)
        return null;
    let endLine = location.range.end.line;
    if (endLine < location.range.start.line)
        endLine = location.range.start.line;
    return {
        uri: location.uri,
        startLine: location.range.start.line,
        endLine: endLine,
    };
}

function BuildDoc(includeDocumentation : boolean, text : string) : ResolvedSymbolDoc
{
    if (!includeDocumentation || !text)
        return null;
    return {
        format: "markdown",
        text: text,
    };
}

function PickScopeEnd(startOffset : number, scopeEnd : number, offsetEnd : number) : number
{
    if (scopeEnd != -1)
        return scopeEnd;
    if (offsetEnd != -1)
        return offsetEnd;
    return startOffset;
}

function BuildTypeSignature(dbtype : typedb.DBType) : string
{
    if (!dbtype)
        return "";
    if (dbtype.isPrimitive)
        return dbtype.name;
    if (dbtype.isEnum)
        return "enum " + dbtype.name;
    if (dbtype.isDelegate)
    {
        let delegateSignature = dbtype.formatDelegateSignature();
        if (delegateSignature && delegateSignature.length != 0)
            return "delegate " + delegateSignature;
        return "delegate " + dbtype.name;
    }
    if (dbtype.isEvent)
    {
        let eventSignature = dbtype.formatDelegateSignature();
        if (eventSignature && eventSignature.length != 0)
            return "event " + eventSignature;
        return "event " + dbtype.name;
    }
    let signature = dbtype.isStruct ? "struct " : "class ";
    signature += dbtype.name;
    if (dbtype.supertype)
        signature += " : " + dbtype.supertype;
    else if (dbtype.unrealsuper)
        signature += " : " + dbtype.unrealsuper;
    return signature;
}

function BuildFunctionSignature(asmodule : scriptfiles.ASModule, offset : number, type : typedb.DBType | typedb.DBNamespace, func : typedb.DBMethod, isAccessor : boolean) : string
{
    let prefix = "";
    let suffix = "";
    if (func.isMixin && func.args && func.args.length != 0)
    {
        prefix = func.args[0].typename + ".";
        suffix = " mixin";
    }
    else if (type instanceof typedb.DBNamespace)
    {
        if (!type.isRootNamespace())
            prefix = type.getQualifiedNamespace() + "::";
    }
    else
    {
        prefix = type.name + ".";
    }

    let determineType : typedb.DBType = null;
    if (func.determinesOutputTypeArgumentIndex != -1)
        determineType = parsedcompletion.GetDetermineTypeFromArguments(asmodule, offset, func.determinesOutputTypeArgumentIndex);

    if (isAccessor)
    {
        if (func.name.startsWith("Get"))
            return func.returnType + " " + prefix + func.name.substring(3);
        if (func.args && func.args.length > 0)
            return func.args[0].typename + " " + prefix + func.name.substring(3);
    }

    return func.format(prefix, func.isMixin, false, null, determineType) + suffix;
}

function PickAccessorMethod(symbols : Array<typedb.DBSymbol>) : typedb.DBMethod
{
    if (!symbols)
        return null;
    for (let sym of symbols)
    {
        if (sym instanceof typedb.DBMethod && sym.findAvailableDocumentation())
            return sym;
    }
    for (let sym of symbols)
    {
        if (sym instanceof typedb.DBMethod)
            return sym;
    }
    return null;
}

function BuildNamespaceDefinition(namespace : typedb.DBNamespace, currentModule : scriptfiles.ASModule) : ResolvedSymbolDefinition
{
    if (!namespace || namespace.declarations.length == 0)
        return null;
    let declaration : typedb.DBNamespaceDeclaration = null;
    if (currentModule)
    {
        for (let decl of namespace.declarations)
        {
            if (decl.declaredModule == currentModule.modulename)
            {
                declaration = decl;
                break;
            }
        }
    }
    if (!declaration)
        declaration = namespace.declarations[0];
    if (!declaration || !declaration.declaredModule)
        return null;
    let declModule = scriptfiles.GetModule(declaration.declaredModule);
    if (!declModule)
        return null;
    let startOffset = declaration.declaredOffset;
    let endOffset = declaration.scopeOffsetEnd;
    if (endOffset < 0)
        endOffset = declaration.declaredOffsetEnd;
    if (endOffset < startOffset)
        endOffset = startOffset;
    return BuildDefinitionFromOffsets(declModule, startOffset, endOffset);
}

function FormatHoverDocumentation(doc : string) : string
{
    if (doc)
    {
        let outDoc = "*";
        outDoc += doc.replace(/\s*\r?\n\s*/g,"*\n\n*");
        outDoc += "*\n\n";
        return outDoc;
    }
    return "";
}

export function resolveSymbolAtPosition(
    asmodule : scriptfiles.ASModule,
    position : Position,
    includeDocumentation : boolean,
    getDefinition : DefinitionResolver
) : ResolveSymbolAtPositionResult
{
    if (!asmodule)
        return { ok: false, error: { code: "NotFound", message: "Module not found." } };
    if (!asmodule.resolved)
        return { ok: false, error: { code: "NotReady", message: "Module is not resolved yet.", retryable: true } };
    if (!position || position.line < 0 || position.character < 0)
        return { ok: false, error: { code: "InvalidParams", message: "Position must be non-negative." } };

    let offset = asmodule.getOffset(position);
    if (offset < 0)
        return { ok: false, error: { code: "InvalidParams", message: "Position out of range." } };

    let findSymbol = asmodule.getSymbolAt(offset);
    if (!findSymbol)
        return { ok: false, error: { code: "NotFound", message: "No symbol found at position." } };

    let kind = "unknown";
    let name = findSymbol.symbol_name ?? "";
    let signature = "";
    let definition : ResolvedSymbolDefinition = null;
    let doc : ResolvedSymbolDoc = null;
    let resolved = false;

    switch (findSymbol.type)
    {
        case scriptfiles.ASSymbolType.Typename:
        {
            let dbtype = typedb.GetTypeByName(findSymbol.symbol_name);
            if (!dbtype)
                return { ok: false, error: { code: "NotFound", message: "Type not found." } };

            if (dbtype.isPrimitive)
                kind = "type";
            else if (dbtype.isEnum)
                kind = "enum";
            else if (dbtype.isDelegate)
                kind = "delegate";
            else if (dbtype.isEvent)
                kind = "event";
            else if (dbtype.isStruct)
                kind = "struct";
            else
                kind = "class";

            name = dbtype.name;
            signature = BuildTypeSignature(dbtype);

            if (dbtype.declaredModule)
            {
                let module = scriptfiles.GetModule(dbtype.declaredModule);
                if (module)
                    definition = BuildDefinitionFromOffsets(module, dbtype.moduleOffset, PickScopeEnd(dbtype.moduleOffset, dbtype.moduleScopeEnd, dbtype.moduleOffsetEnd));
            }

            doc = BuildDoc(includeDocumentation, FormatHoverDocumentation(dbtype.documentation));
            resolved = true;
        }
        break;
        case scriptfiles.ASSymbolType.Namespace:
        {
            let namespace = typedb.LookupNamespace(null, findSymbol.symbol_name);
            if (!namespace)
                return { ok: false, error: { code: "NotFound", message: "Namespace not found." } };

            kind = "namespace";
            name = namespace.getQualifiedNamespace();
            signature = "namespace " + name;
            definition = BuildNamespaceDefinition(namespace, asmodule);
            doc = BuildDoc(includeDocumentation, FormatHoverDocumentation(namespace.documentation));
            resolved = true;
        }
        break;
        case scriptfiles.ASSymbolType.LocalVariable:
        case scriptfiles.ASSymbolType.Parameter:
        {
            let scope = asmodule.getScopeAt(offset);
            while (scope)
            {
                if (!scope.isInFunctionBody())
                    break;

                for (let asvar of scope.variables)
                {
                    if (asvar.name == findSymbol.symbol_name)
                    {
                        kind = (findSymbol.type == scriptfiles.ASSymbolType.Parameter) ? "parameter" : "variable";
                        name = asvar.name;
                        signature = asvar.typename + " " + asvar.name;
                        definition = BuildDefinitionFromOffsets(asmodule, asvar.start_offset_name, asvar.end_offset_name);
                        doc = BuildDoc(includeDocumentation, FormatHoverDocumentation(asvar.documentation));
                        resolved = true;
                        scope = null;
                        break;
                    }
                }
                if (scope)
                    scope = scope.parentscope;
            }
        }
        break;
        case scriptfiles.ASSymbolType.MemberFunction:
        {
            let insideType = typedb.GetTypeByName(findSymbol.container_type);
            if (!insideType)
                return { ok: false, error: { code: "NotFound", message: "Containing type not found." } };

            let symbols = insideType.findSymbols(findSymbol.symbol_name);
            let methods : Array<typedb.DBMethod> = [];

            for (let func of symbols)
            {
                if (func instanceof typedb.DBMethod)
                    methods.push(func);
            }

            if (methods.length > 1)
                parsedcompletion.SortMethodsBasedOnArgumentTypes(methods, asmodule, findSymbol.end + 2);

            if (methods.length == 0)
                return { ok: false, error: { code: "NotFound", message: "Method not found." } };

            let method = methods[0];
            kind = "method";
            name = method.name;
            signature = BuildFunctionSignature(asmodule, findSymbol.end + 2, insideType, method, false);
            doc = BuildDoc(includeDocumentation, FormatFunctionDocumentation(method.findAvailableDocumentation(), method));

            if (method.declaredModule)
            {
                let module = scriptfiles.GetModule(method.declaredModule);
                if (module)
                    definition = BuildDefinitionFromOffsets(module, method.moduleOffset, PickScopeEnd(method.moduleOffset, method.moduleScopeEnd, method.moduleOffsetEnd));
            }
            resolved = true;
        }
        break;
        case scriptfiles.ASSymbolType.GlobalFunction:
        {
            let namespace = typedb.LookupNamespace(null, findSymbol.container_type);
            if (!namespace)
                return { ok: false, error: { code: "NotFound", message: "Namespace not found." } };

            let symbols = namespace.findSymbols(findSymbol.symbol_name);
            let methods : Array<typedb.DBMethod> = [];

            for (let func of symbols)
            {
                if (func instanceof typedb.DBMethod)
                    methods.push(func);
            }

            if (methods.length > 1)
                parsedcompletion.SortMethodsBasedOnArgumentTypes(methods, asmodule, findSymbol.end + 2);

            if (methods.length == 0)
                return { ok: false, error: { code: "NotFound", message: "Function not found." } };

            let method = methods[0];
            kind = "function";
            name = method.name;
            signature = BuildFunctionSignature(asmodule, findSymbol.end + 2, namespace, method, false);
            doc = BuildDoc(includeDocumentation, FormatFunctionDocumentation(method.findAvailableDocumentation(), method));

            if (method.declaredModule)
            {
                let module = scriptfiles.GetModule(method.declaredModule);
                if (module)
                    definition = BuildDefinitionFromOffsets(module, method.moduleOffset, PickScopeEnd(method.moduleOffset, method.moduleScopeEnd, method.moduleOffsetEnd));
            }
            resolved = true;
        }
        break;
        case scriptfiles.ASSymbolType.MemberVariable:
        {
            let insideType = typedb.GetTypeByName(findSymbol.container_type);
            if (!insideType)
                return { ok: false, error: { code: "NotFound", message: "Containing type not found." } };

            let sym = insideType.findFirstSymbol(findSymbol.symbol_name, typedb.DBAllowSymbol.Properties);
            if (!(sym instanceof typedb.DBProperty))
                return { ok: false, error: { code: "NotFound", message: "Property not found." } };

            kind = "property";
            name = sym.name;
            signature = sym.format();
            doc = BuildDoc(includeDocumentation, FormatPropertyDocumentation(sym.documentation));

            if (sym.declaredModule)
            {
                let module = scriptfiles.GetModule(sym.declaredModule);
                if (module)
                    definition = BuildDefinitionFromOffsets(module, sym.moduleOffset, PickScopeEnd(sym.moduleOffset, -1, sym.moduleOffsetEnd));
            }
            resolved = true;
        }
        break;
        case scriptfiles.ASSymbolType.GlobalVariable:
        {
            let namespace = typedb.LookupNamespace(null, findSymbol.container_type);
            if (!namespace)
                return { ok: false, error: { code: "NotFound", message: "Namespace not found." } };

            let sym = namespace.findFirstSymbol(findSymbol.symbol_name, typedb.DBAllowSymbol.Properties);
            if (!(sym instanceof typedb.DBProperty))
                return { ok: false, error: { code: "NotFound", message: "Property not found." } };

            let prefix = null;
            if (!namespace.isRootNamespace())
                prefix = namespace.getQualifiedNamespace() + "::";

            kind = "property";
            name = sym.name;
            signature = sym.format(prefix);
            doc = BuildDoc(includeDocumentation, FormatPropertyDocumentation(sym.documentation));

            if (sym.declaredModule)
            {
                let module = scriptfiles.GetModule(sym.declaredModule);
                if (module)
                    definition = BuildDefinitionFromOffsets(module, sym.moduleOffset, PickScopeEnd(sym.moduleOffset, -1, sym.moduleOffsetEnd));
            }
            resolved = true;
        }
        break;
        case scriptfiles.ASSymbolType.MemberAccessor:
        {
            let insideType = typedb.GetTypeByName(findSymbol.container_type);
            if (!insideType)
                return { ok: false, error: { code: "NotFound", message: "Containing type not found." } };

            let accessName = findSymbol.symbol_name;
            if (accessName.startsWith("Get") || accessName.startsWith("Set"))
                accessName = accessName.substring(3);

            let dbSymbols = [
                ...insideType.findSymbols("Get" + accessName),
                ...insideType.findSymbols("Set" + accessName),
            ];

            let method = PickAccessorMethod(dbSymbols);
            if (!method)
                return { ok: false, error: { code: "NotFound", message: "Accessor not found." } };

            kind = "method";
            name = method.name;
            signature = BuildFunctionSignature(asmodule, findSymbol.end + 2, insideType, method, true);
            doc = BuildDoc(includeDocumentation, FormatFunctionDocumentation(method.findAvailableDocumentation(), method));

            if (method.declaredModule)
            {
                let module = scriptfiles.GetModule(method.declaredModule);
                if (module)
                    definition = BuildDefinitionFromOffsets(module, method.moduleOffset, PickScopeEnd(method.moduleOffset, method.moduleScopeEnd, method.moduleOffsetEnd));
            }
            resolved = true;
        }
        break;
        case scriptfiles.ASSymbolType.GlobalAccessor:
        {
            let namespace = typedb.LookupNamespace(null, findSymbol.container_type);
            if (!namespace)
                return { ok: false, error: { code: "NotFound", message: "Namespace not found." } };

            let accessName = findSymbol.symbol_name;
            if (accessName.startsWith("Get") || accessName.startsWith("Set"))
                accessName = accessName.substring(3);

            let dbSymbols = [
                ...namespace.findSymbols("Get" + accessName),
                ...namespace.findSymbols("Set" + accessName),
            ];

            let method = PickAccessorMethod(dbSymbols);
            if (!method)
                return { ok: false, error: { code: "NotFound", message: "Accessor not found." } };

            kind = "method";
            name = method.name;
            signature = BuildFunctionSignature(asmodule, findSymbol.end + 2, namespace, method, true);
            doc = BuildDoc(includeDocumentation, FormatFunctionDocumentation(method.findAvailableDocumentation(), method));

            if (method.declaredModule)
            {
                let module = scriptfiles.GetModule(method.declaredModule);
                if (module)
                    definition = BuildDefinitionFromOffsets(module, method.moduleOffset, PickScopeEnd(method.moduleOffset, method.moduleScopeEnd, method.moduleOffsetEnd));
            }
            resolved = true;
        }
        break;
        case scriptfiles.ASSymbolType.AccessSpecifier:
        {
            kind = "unknown";
            signature = "access " + findSymbol.symbol_name;
            if (includeDocumentation)
                doc = BuildDoc(true, `Access specifier \`${findSymbol.symbol_name}\` restricts which other classes this can be used from`);

            let scope = asmodule.getScopeAt(offset);
            if (scope)
            {
                let dbtype = scope.getParentType();
                if (dbtype)
                {
                    let spec = dbtype.getAccessSpecifier(findSymbol.symbol_name, false);
                    if (spec && spec.declaredModule)
                    {
                        let module = scriptfiles.GetModule(spec.declaredModule);
                        if (module)
                            definition = BuildDefinitionFromOffsets(module, spec.moduleOffset, PickScopeEnd(spec.moduleOffset, -1, spec.moduleOffsetEnd));
                    }
                }
            }
            resolved = true;
        }
        break;
    }

    if (!resolved)
        return { ok: false, error: { code: "NotFound", message: "Symbol not resolved." } };

    if (!signature || signature.length == 0)
        signature = name;

    if (!definition)
    {
        let defs = getDefinition(asmodule, position);
        if (defs && defs.length > 0)
            definition = BuildDefinitionFromLocation(defs[0]);
    }

    let symbol : ResolvedSymbolInfo = {
        kind: kind,
        name: name,
        signature: signature,
    };
    if (definition)
        symbol.definition = definition;
    if (doc)
        symbol.doc = doc;

    return { ok: true, symbol: symbol };
}
