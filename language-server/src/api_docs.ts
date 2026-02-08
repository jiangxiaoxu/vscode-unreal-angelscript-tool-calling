import * as scriptfiles from './as_parser';
import * as typedb from './database';
import * as documentation from './documentation';
import * as fs from 'fs';
import * as path from 'path';

type ApiSearchSource = "native" | "script" | "both";

type TypeMemberVisibility = "public" | "protected" | "private";

type TypeMembersParams = {
    name: string;
    namespace?: string;
    includeInherited?: boolean;
    includeDocs?: boolean;
    kinds?: "both" | "method" | "property";
};

type TypeMemberInfo = {
    kind: "method" | "property";
    name: string;
    signature: string;
    description: string;
    declaredIn: string;
    declaredInKind: "type" | "namespace";
    isInherited: boolean;
    isMixin: boolean;
    isAccessor: boolean;
    accessorKind?: "get" | "set";
    propertyName?: string;
    visibility: TypeMemberVisibility;
};

type TypeMembersResult = {
    ok: true;
    type: {
        name: string;
        namespace: string;
        qualifiedName: string;
    };
    members: TypeMemberInfo[];
} | {
    ok: false;
    error: {
        code: "NotFound" | "InvalidParams";
        message: string;
    };
};

type TypeHierarchyParams = {
    name: string;
    maxSuperDepth?: number;
    maxSubDepth?: number;
    maxSubBreadth?: number;
};

type TypeHierarchyResult = {
    ok: true;
    root: string;
    supers: string[];
    derivedByParent: Record<string, string[]>;
    sourceByClass: Record<string, {
        source: "cpp";
    } | {
        source: "as";
        filePath: string;
        startLine: number;
        endLine: number;
    }>;
    limits: {
        maxSuperDepth: number;
        maxSubDepth: number;
        maxSubBreadth: number;
    };
    truncated: {
        supers: boolean;
        derivedDepth: boolean;
        derivedBreadthByClass: Record<string, number>;
    };
} | {
    ok: false;
    error: {
        code: "NotFound" | "InvalidParams";
        message: string;
    };
};

function normalizeSearchSource(raw: unknown) : ApiSearchSource
{
    if (typeof raw !== "string")
        return "both";
    let value = raw.trim().toLowerCase();
    if (value == "" || value == "both")
        return "both";
    if (value == "native")
        return "native";
    if (value == "script")
        return "script";
    return "both";
}

function matchesSearchSource(declaredModule: string | null | undefined, source: ApiSearchSource) : boolean
{
    if (source == "both")
        return true;
    let isScript = typeof declaredModule == "string" && declaredModule.length > 0;
    return source == "script" ? isScript : !isScript;
}

function normalizeNamespaceName(raw: unknown) : string | null
{
    if (typeof raw !== "string")
        return null;
    let trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : "";
}

function normalizeTypeMemberKinds(raw: unknown) : "both" | "method" | "property"
{
    if (typeof raw !== "string")
        return "both";
    let value = raw.trim().toLowerCase();
    if (value == "method" || value == "property" || value == "both")
        return value as "both" | "method" | "property";
    return "both";
}

function splitQualifiedTypeName(name: string) : { typeName: string; namespaceName: string | null }
{
    let separatorIndex = name.lastIndexOf("::");
    if (separatorIndex <= 0)
        return { typeName: name, namespaceName: null };
    let namespaceName = name.substring(0, separatorIndex);
    let typeName = name.substring(separatorIndex + 2);
    if (!typeName)
        return { typeName: name, namespaceName: null };
    return { typeName, namespaceName };
}

function resolveTypeByName(rawName: unknown, rawNamespace: unknown) : typedb.DBType | null
{
    if (typeof rawName !== "string")
        return null;
    let name = rawName.trim();
    if (name.length == 0)
        return null;

    let namespaceName = normalizeNamespaceName(rawNamespace);
    if (!namespaceName)
    {
        let split = splitQualifiedTypeName(name);
        if (split.namespaceName)
        {
            namespaceName = split.namespaceName;
            name = split.typeName;
        }
    }

    let namespace : typedb.DBNamespace = null;
    if (namespaceName !== null)
    {
        if (namespaceName.length == 0)
            namespace = typedb.GetRootNamespace();
        else
            namespace = typedb.LookupNamespace(null, namespaceName);
    }

    let dbType = namespace ? typedb.LookupType(namespace, name) : typedb.GetTypeByName(name);
    if (!dbType && namespace)
        dbType = typedb.GetTypeByName(name);
    return dbType;
}

function isClassType(dbType: typedb.DBType) : boolean
{
    if (!dbType)
        return false;
    return !dbType.isPrimitive && !dbType.isEnum && !dbType.isStruct && !dbType.isDelegate && !dbType.isEvent;
}

function buildTypeHierarchyEntry(dbType: typedb.DBType) : "cpp" | "as"
{
    return dbType.isUnrealType() ? "cpp" : "as";
}

function getLineFromOffset(content: string, offset: number) : number
{
    let safeOffset = offset;
    if (safeOffset < 0)
        safeOffset = 0;
    if (safeOffset > content.length)
        safeOffset = content.length;

    let line = 1;
    for (let i = 0; i < safeOffset; ++i)
    {
        if (content.charCodeAt(i) == 10)
            line += 1;
    }
    return line;
}

function getModuleRelativePath(modulename: string) : string
{
    if (!modulename || modulename.length == 0)
        return "";
    return modulename.replace(/\./g, "/") + ".as";
}

function findLastMatchIndex(text: string, regex: RegExp) : number
{
    let flags = regex.flags;
    if (!flags.includes("g"))
        flags += "g";

    let matchRegex = new RegExp(regex.source, flags);
    let match : RegExpExecArray = null;
    let foundIndex = -1;
    while ((match = matchRegex.exec(text)) !== null)
    {
        foundIndex = match.index ?? -1;
        if (match[0].length == 0)
            matchRegex.lastIndex += 1;
    }

    return foundIndex;
}

function getClassStartOffset(content: string, scopeStartOffset: number, nameOffset: number) : number
{
    if (!content)
        return nameOffset;

    let safeScopeStart = scopeStartOffset;
    let safeNameOffset = nameOffset;
    if (safeScopeStart < 0)
        safeScopeStart = 0;
    if (safeScopeStart > content.length)
        safeScopeStart = content.length;

    if (safeNameOffset < safeScopeStart)
        safeNameOffset = safeScopeStart;
    if (safeNameOffset > content.length)
        safeNameOffset = content.length;

    let header = content.substring(safeScopeStart, safeNameOffset);
    if (header.length == 0)
        return safeNameOffset;

    let macroIndex = findLastMatchIndex(header, /UCLASS\s*\(/);
    if (macroIndex >= 0)
        return safeScopeStart + macroIndex;

    let classIndex = findLastMatchIndex(header, /\bclass\b/);
    if (classIndex >= 0)
        return safeScopeStart + classIndex;

    return safeNameOffset;
}

function getScriptClassSourceInfo(dbType: typedb.DBType) : {
    source: "cpp";
} | {
    source: "as";
    filePath: string;
    startLine: number;
    endLine: number;
}
{
    if (dbType.isUnrealType())
        return { source: "cpp" };

    let moduleName = dbType.declaredModule;
    let module = scriptfiles.GetModule(moduleName);
    let fallbackPath = getModuleRelativePath(moduleName);
    let filePath = fallbackPath;
    if (module && module.filename && module.filename.length != 0)
        filePath = path.normalize(module.filename);

    if (!moduleName || moduleName.length == 0 || (filePath.length == 0 && fallbackPath.length == 0))
    {
        return {
            source: "as",
            filePath: filePath,
            startLine: 1,
            endLine: 1,
        };
    }

    let scopeStartOffset = dbType.moduleScopeStart >= 0 ? dbType.moduleScopeStart : dbType.moduleOffset;
    let nameOffset = dbType.moduleOffset >= 0 ? dbType.moduleOffset : scopeStartOffset;
    if (nameOffset < scopeStartOffset)
        nameOffset = scopeStartOffset;

    let endOffset = dbType.moduleOffsetEnd;
    if (dbType.moduleScopeEnd > nameOffset)
        endOffset = dbType.moduleScopeEnd;
    if (endOffset < nameOffset)
        endOffset = nameOffset;

    if (module && module.loaded && module.textDocument)
    {
        let startOffset = getClassStartOffset(module.content, scopeStartOffset, nameOffset);
        let startLine = module.getPosition(startOffset).line + 1;
        let endLine = module.getPosition(endOffset).line + 1;
        if (endLine < startLine)
            endLine = startLine;
        return {
            source: "as",
            filePath: filePath,
            startLine: startLine,
            endLine: endLine,
        };
    }

    if (module && module.filename && module.filename.length != 0)
    {
        try
        {
            let content = fs.readFileSync(module.filename, "utf8");
            let startOffset = getClassStartOffset(content, scopeStartOffset, nameOffset);
            let startLine = getLineFromOffset(content, startOffset);
            let endLine = getLineFromOffset(content, endOffset);
            if (endLine < startLine)
                endLine = startLine;
            return {
                source: "as",
                filePath: filePath,
                startLine: startLine,
                endLine: endLine,
            };
        }
        catch
        {
        }
    }

    return {
        source: "as",
        filePath: filePath,
        startLine: 1,
        endLine: 1,
    };
}

function resolveHierarchySuperType(dbType: typedb.DBType) : typedb.DBType | null
{
    if (!dbType)
        return null;
    if (dbType.supertype)
    {
        let superType = typedb.LookupType(dbType.namespace, dbType.supertype) ?? typedb.GetTypeByName(dbType.supertype);
        if (isClassType(superType))
            return superType;
    }
    if (dbType.unrealsuper)
    {
        let unrealSuper = typedb.LookupType(dbType.namespace, dbType.unrealsuper) ?? typedb.GetTypeByName(dbType.unrealsuper);
        if (isClassType(unrealSuper))
            return unrealSuper;
    }
    return null;
}

function buildSubtypeIndex() : Map<string, Array<typedb.DBType>>
{
    let index = new Map<string, Array<typedb.DBType>>();
    for (let [_, checkType] of typedb.GetAllTypesById())
    {
        if (!isClassType(checkType))
            continue;
        let parents: Array<string> = [];
        if (checkType.supertype)
            parents.push(checkType.supertype);
        if (checkType.unrealsuper && checkType.unrealsuper != checkType.supertype)
            parents.push(checkType.unrealsuper);

        for (let parentName of parents)
        {
            let parentType = typedb.LookupType(checkType.namespace, parentName) ?? typedb.GetTypeByName(parentName);
            if (parentType && !isClassType(parentType))
                continue;
            let bucket = index.get(parentName);
            if (!bucket)
            {
                bucket = [];
                index.set(parentName, bucket);
            }
            if (!bucket.includes(checkType))
                bucket.push(checkType);
        }
    }
    return index;
}

function buildDerivedEdges(
    dbType: typedb.DBType,
    maxDepth: number,
    maxBreadth: number,
    index: Map<string, Array<typedb.DBType>>,
    visited: Set<typedb.DBType>,
    derivedByParent: Record<string, string[]>,
    sourceByClass: Record<string, {
        source: "cpp";
    } | {
        source: "as";
        filePath: string;
        startLine: number;
        endLine: number;
    }>,
    breadthTruncatedByClass: Record<string, number>
) : boolean
{
    let children = (index.get(dbType.name) ?? []).slice();
    children.sort((left, right) =>
    {
        if (left.name < right.name)
            return -1;
        if (left.name > right.name)
            return 1;
        return 0;
    });

    let visibleChildren = new Array<typedb.DBType>();
    for (let child of children)
    {
        if (!visited.has(child))
            visibleChildren.push(child);
    }

    if (maxDepth <= 0)
    {
        return visibleChildren.length > 0;
    }

    let keptChildren = visibleChildren;
    if (visibleChildren.length > maxBreadth)
    {
        breadthTruncatedByClass[dbType.name] = visibleChildren.length - maxBreadth;
        keptChildren = visibleChildren.slice(0, maxBreadth);
    }

    if (keptChildren.length > 0)
        derivedByParent[dbType.name] = [];

    let depthTruncated = false;
    for (let child of keptChildren)
    {
        visited.add(child);
        sourceByClass[child.name] = getScriptClassSourceInfo(child);
        derivedByParent[dbType.name].push(child.name);
        if (buildDerivedEdges(child, maxDepth - 1, maxBreadth, index, visited, derivedByParent, sourceByClass, breadthTruncatedByClass))
            depthTruncated = true;
    }

    return depthTruncated;
}

function getTypeVisibility(isPrivate: boolean, isProtected: boolean) : TypeMemberVisibility
{
    if (isPrivate)
        return "private";
    if (isProtected)
        return "protected";
    return "public";
}

function getVisibilityPrefix(visibility: TypeMemberVisibility) : string
{
    if (visibility == "private")
        return "private ";
    if (visibility == "protected")
        return "protected ";
    return "";
}

function formatFunctionDocumentationPlain(doc : string) : string
{
    if (!doc)
        return "";
    let lines = doc.split("\n");
    let result : Array<string> = [];

    for (let line of lines)
    {
        let trimmed = line.trim();
        if (trimmed.startsWith("@param"))
        {
            let match = trimmed.match(/@param\s+([A-Za-z0-9_]+)\s*(.*)/);
            if (match)
            {
                let name = match[1];
                let desc = match[2] ?? "";
                let entry = desc.length > 0 ? `param ${name}: ${desc}` : `param ${name}`;
                result.push(entry.trim());
                continue;
            }
        }
        if (trimmed.startsWith("@return"))
        {
            let desc = trimmed.substring(7).trim();
            result.push(desc.length > 0 ? `return: ${desc}` : "return");
            continue;
        }
        if (trimmed.startsWith("@note"))
        {
            let desc = trimmed.substring(5).trim();
            result.push(desc.length > 0 ? `note: ${desc}` : "note");
            continue;
        }
        if (trimmed.startsWith("@see"))
        {
            let desc = trimmed.substring(4).trim();
            result.push(desc.length > 0 ? `see: ${desc}` : "see");
            continue;
        }
        if (trimmed.length > 0)
            result.push(trimmed);
        else
            result.push("");
    }

    return result.join("\n").trim();
}

function formatPropertyDocumentationPlain(doc : string) : string
{
    if (!doc)
        return "";
    let lines = doc.split("\n");
    let result : Array<string> = [];

    for (let line of lines)
    {
        let trimmed = line.trim();
        if (trimmed.startsWith("@note"))
        {
            let desc = trimmed.substring(5).trim();
            result.push(desc.length > 0 ? `note: ${desc}` : "note");
            continue;
        }
        if (trimmed.startsWith("@see"))
        {
            let desc = trimmed.substring(4).trim();
            result.push(desc.length > 0 ? `see: ${desc}` : "see");
            continue;
        }
        if (trimmed.length > 0)
            result.push(trimmed);
        else
            result.push("");
    }

    return result.join("\n").trim();
}

function buildAccessorSignature(method: typedb.DBMethod, prefix: string, accessorKind: "get" | "set", propertyName: string) : string
{
    if (accessorKind == "get")
        return `${method.returnType} ${prefix}${propertyName}`;
    if (method.isMixin)
    {
        if (method.args && method.args.length > 1)
            return `${method.args[1].typename} ${prefix}${propertyName}`;
    }
    if (method.args && method.args.length > 0)
        return `${method.args[0].typename} ${prefix}${propertyName}`;
    return `${method.returnType} ${prefix}${propertyName}`;
}

function buildMethodSignature(method: typedb.DBMethod, declaredInName: string, isAccessor: boolean, accessorKind: "get" | "set" | null, propertyName: string | null) : string
{
    let prefix = "";
    let skipFirstArg = false;
    if (method.isMixin)
    {
        if (method.args && method.args.length > 0)
            prefix = method.args[0].typename + ".";
        skipFirstArg = true;
    }
    else if (declaredInName && declaredInName.length > 0)
    {
        prefix = declaredInName + ".";
    }

    if (isAccessor && accessorKind && propertyName)
        return buildAccessorSignature(method, prefix, accessorKind, propertyName);

    return method.format(prefix, skipFirstArg);
}

export function GetAPIList(root: string): any
{
    let list: any[] = [];

    // Strip away the prefixes that are needed for cases where a namespace and a property with the same name can both exist next to each other
    root = root.replace(/__(ns|fun|prop)_/, "");

    let addType = function (type: typedb.DBType | typedb.DBNamespace)
    {
        if (type instanceof typedb.DBNamespace)
        {
            for (let [_, childNamespace] of type.childNamespaces)
            {
                if (childNamespace.isShadowingType())
                    continue;

                list.push({
                    "type": "namespace",
                    "id": childNamespace.getQualifiedNamespace(),
                    "data": ["namespace", childNamespace.getQualifiedNamespace()],
                    "label": childNamespace.getQualifiedNamespace() + "::",
                });
            }

            if (type.isRootNamespace())
            {
                list.sort(function (a, b)
                {
                    if (a.label < b.label)
                        return -1;
                    else if (a.label > b.label)
                        return 1;
                    else
                        return 0;
                });
                return;
            }
        }

        type.forEachSymbol(function (symbol: typedb.DBSymbol)
        {
            if (symbol instanceof typedb.DBMethod)
            {
                if (symbol.isMixin)
                    return;
                list.push({
                    "type": "function",
                    "label": symbol.name + "()",
                    "id": symbol.id.toString(),
                    "data": ["function", symbol.namespace.getQualifiedNamespace() + "::" + symbol.name, symbol.id],
                });
            }
            else if (symbol instanceof typedb.DBProperty)
            {
                list.push({
                    "type": "property",
                    "label": symbol.name,
                    "id": symbol.namespace.getQualifiedNamespace() + "::" + symbol.name,
                    "data": ["global", symbol.namespace.getQualifiedNamespace() + "::" + symbol.name],
                });
            }
        });
    }

    if (!root)
    {
        addType(typedb.GetRootNamespace());
    }
    else
    {
        let namespace = typedb.LookupNamespace(null, root);
        if (namespace)
        {
            addType(namespace);
        }
    }

    return list;
}

export function GetAPIDetails(data: any): any
{
    if (data[0] == "namespace")
    {
        let namespace = typedb.LookupNamespace(null, data[1]);
        if (namespace)
        {
            return namespace.documentation ?? "";
        }
    }
    else if (data[0] == "function" || data[0] == "method")
    {
        let method: typedb.DBMethod;
        let symbols: Array<typedb.DBSymbol>;
        let method_id = 0;
        if (data[0] == "function")
        {
            symbols = typedb.LookupGlobalSymbol(null, data[1]);
            if (typeof data[2] === "number")
                method_id = data[2];
        }
        else
        {
            let typeNamespaceName = typeof data[4] === "string" ? data[4] : "";
            let typeNamespace = null;
            if (typeNamespaceName.length > 0)
                typeNamespace = typedb.LookupNamespace(null, typeNamespaceName);
            else if (typeNamespaceName === "")
                typeNamespace = typedb.GetRootNamespace();
            let dbType = typeNamespace ? typedb.LookupType(typeNamespace, data[1]) : typedb.GetTypeByName(data[1]);
            if (!dbType && typeNamespace)
                dbType = typedb.GetTypeByName(data[1]);
            if (dbType)
                symbols = dbType.findSymbols(data[2]);
            if (typeof data[3] === "number")
                method_id = data[3];
        }

        if (method_id != 0)
        {
            for (let symbol of symbols)
            {
                if (symbol instanceof typedb.DBMethod)
                {
                    if (symbol.id != method_id)
                        continue;
                    method = symbol;
                }
            }
        }

        if (!method)
        {
            let signature: Array<string> = null;
            if (Array.isArray(data[4]))
                signature = data[4];
            else if (Array.isArray(data[5]))
                signature = data[5];
            else if (Array.isArray(data[3]))
                signature = data[3];

            if (signature)
            {
                for (let symbol of symbols)
                {
                    if (!(symbol instanceof typedb.DBMethod))
                        continue;
                    let args = symbol.args ?? [];
                    if (args.length != signature.length)
                        continue;
                    let matches = true;
                    for (let i = 0; i < signature.length; ++i)
                    {
                        if (!typedb.TypenameEquals(args[i].typename, signature[i]))
                        {
                            matches = false;
                            break;
                        }
                    }
                    if (matches)
                    {
                        method = symbol;
                        break;
                    }
                }
            }

            if (!method)
            {
                for (let symbol of symbols)
                {
                    if (symbol instanceof typedb.DBMethod)
                    {
                        method = symbol;
                    }
                }
            }
        }

        if (!method)
            return ""

        let details = "```angelscript_snippet\n";
        details += method.returnType;
        details += " ";
        if (method.containingType)
        {
            details += method.containingType.getQualifiedTypenameInNamespace(null);
            details += ".";
        }
        else if (method.isMixin)
        {
            details += method.args[0].typename;
            details += ".";
        }
        else
        {
            details += method.namespace.getQualifiedNamespace();
            details += "::";
        }

        details += method.name;

        if (method.args && method.args.length > 0)
        {
            details += "(";
            for (let i = 0; i < method.args.length; ++i)
            {
                if (method.isMixin && i == 0)
                    continue;
                details += "\n\t\t";
                details += method.args[i].format();
                if (i + 1 < method.args.length)
                    details += ",";
            }
            details += "\n)";
        }
        else
        {
            details += "()";
        }

        details += "\n```\n";

        let doc = method.findAvailableDocumentation();
        if (doc)
            details += documentation.FormatFunctionDocumentation(doc, method);

        return details;
    }
    else if (data[0] == "global")
    {
        let symbols = typedb.LookupGlobalSymbol(null, data[1]);
        for (let symbol of symbols)
        {
            if (symbol instanceof typedb.DBProperty)
            {
                let details = "```angelscript_snippet\n" + symbol.format(
                    symbol.namespace.getQualifiedNamespace() + "::"
                ) + "\n```\n";
                details += documentation.FormatPropertyDocumentation(symbol.documentation);

                return details;
            }
        }
    }
    else if (data[0] == "property")
    {
        let dbType = typedb.GetTypeByName(data[1]);
        if (!dbType)
            return "";
        let symbols = dbType.findSymbols(data[2]);
        for (let symbol of symbols)
        {
            if (symbol instanceof typedb.DBProperty)
            {
                let details = "```angelscript_snippet\n" + symbol.format(
                    symbol.containingType.getQualifiedTypenameInNamespace(null) + "."
                ) + "\n```\n";
                details += documentation.FormatPropertyDocumentation(symbol.documentation);

                return details;
            }
        }
    }
    else if (data[0] == "type")
    {
        let typeNamespaceName = typeof data[2] === "string" ? data[2] : "";
        let typeNamespace = null;
        if (typeNamespaceName.length > 0)
            typeNamespace = typedb.LookupNamespace(null, typeNamespaceName);
        else if (typeNamespaceName === "")
            typeNamespace = typedb.GetRootNamespace();

        let dbType = typeNamespace ? typedb.LookupType(typeNamespace, data[1]) : typedb.GetTypeByName(data[1]);
        if (!dbType && typeNamespace)
            dbType = typedb.GetTypeByName(data[1]);
        if (!dbType)
            return "";

        let details = "```angelscript_snippet\n";
        if (dbType.isEnum)
            details += "enum ";
        else if (dbType.isStruct)
            details += "struct ";
        else
            details += "class ";
        details += dbType.getQualifiedTypenameInNamespace(null);
        if (dbType.supertype && !dbType.isEnum)
            details += " : " + dbType.supertype;
        details += "\n```\n";

        if (dbType.documentation)
            details += documentation.FormatPropertyDocumentation(dbType.documentation);

        return details;
    }

    return "";
}

export function GetAPIDetailsBatch(dataList: any[]): any
{
    if (!Array.isArray(dataList) || dataList.length == 0)
        return [];

    return dataList.map((data) => GetAPIDetails(data));
}

export function GetTypeMembers(params: TypeMembersParams) : TypeMembersResult
{
    if (!params || typeof params !== "object")
        return { ok: false, error: { code: "InvalidParams", message: "Invalid params. Provide { name: string, namespace?: string, includeInherited?: boolean, includeDocs?: boolean, kinds?: 'both' | 'method' | 'property' }." } };

    let name = typeof params.name === "string" ? params.name.trim() : "";
    if (name.length == 0)
        return { ok: false, error: { code: "InvalidParams", message: "Invalid params. 'name' must be a non-empty string." } };

    let includeInherited = params.includeInherited === true;
    let includeDocs = params.includeDocs === true;
    let kinds = normalizeTypeMemberKinds(params.kinds);
    let allowMethods = kinds != "property";
    let allowProperties = kinds != "method";
    let dbType = resolveTypeByName(name, params.namespace);
    if (!dbType)
        return { ok: false, error: { code: "NotFound", message: "Type not found." } };

    let typeNamespace = dbType.namespace && !dbType.namespace.isRootNamespace()
        ? dbType.namespace.getQualifiedNamespace()
        : "";
    let qualifiedName = dbType.getQualifiedTypenameInNamespace(null);

    let members: TypeMemberInfo[] = [];
    let seenMembers = new Set<string>();
    let typeList = includeInherited ? dbType.getExtendTypesList() : [dbType];

    for (let checkType of typeList)
    {
        let declaredInName = checkType.getQualifiedTypenameInNamespace(null);
        let isInherited = checkType != dbType;

        checkType.forEachSymbol(function (symbol: typedb.DBSymbol)
        {
            if (symbol instanceof typedb.DBMethod)
            {
                if (!allowMethods)
                    return;
                if (symbol.isConstructor)
                    return;
                if (isInherited && symbol.isPrivate)
                    return;

                let visibility = getTypeVisibility(symbol.isPrivate, symbol.isProtected);
                let accessorKind : "get" | "set" | null = null;
                let propertyName : string | null = null;
                let isAccessor = false;
                if (symbol.isProperty)
                {
                    if (symbol.name.startsWith("Get"))
                    {
                        accessorKind = "get";
                        propertyName = symbol.name.substring(3);
                        isAccessor = propertyName.length > 0;
                    }
                    else if (symbol.name.startsWith("Set"))
                    {
                        accessorKind = "set";
                        propertyName = symbol.name.substring(3);
                        isAccessor = propertyName.length > 0;
                    }
                }

                let signature = buildMethodSignature(symbol, declaredInName, isAccessor, accessorKind, propertyName);
                let description = "";
                if (includeDocs)
                    description = formatFunctionDocumentationPlain(symbol.findAvailableDocumentation());

                signature = getVisibilityPrefix(visibility) + signature;

                let key = `method|${symbol.id}|${declaredInName}`;
                if (seenMembers.has(key))
                    return;
                seenMembers.add(key);

                members.push({
                    kind: "method",
                    name: symbol.name,
                    signature: signature,
                    description: description ?? "",
                    declaredIn: declaredInName,
                    declaredInKind: "type",
                    isInherited: isInherited,
                    isMixin: symbol.isMixin,
                    isAccessor: isAccessor,
                    accessorKind: accessorKind ?? undefined,
                    propertyName: propertyName ?? undefined,
                    visibility: visibility,
                });
            }
            else if (symbol instanceof typedb.DBProperty)
            {
                if (!allowProperties)
                    return;
                if (isInherited && symbol.isPrivate)
                    return;

                let visibility = getTypeVisibility(symbol.isPrivate, symbol.isProtected);
                let prefix = declaredInName.length > 0 ? declaredInName + "." : "";
                let signature = symbol.format(prefix);
                let description = "";
                if (includeDocs)
                    description = formatPropertyDocumentationPlain(symbol.documentation);

                let key = `property|${declaredInName}|${symbol.name}|${symbol.typename}`;
                if (seenMembers.has(key))
                    return;
                seenMembers.add(key);

                members.push({
                    kind: "property",
                    name: symbol.name,
                    signature: signature,
                    description: description ?? "",
                    declaredIn: declaredInName,
                    declaredInKind: "type",
                    isInherited: isInherited,
                    isMixin: false,
                    isAccessor: false,
                    visibility: visibility,
                });
            }
        }, false);
    }

    let mixinSeen = new Set<number>();
    let visitNamespace = function (namespace: typedb.DBNamespace)
    {
        if (!allowMethods)
            return;
        namespace.forEachSymbol(function (symbol: typedb.DBSymbol)
        {
            if (!(symbol instanceof typedb.DBMethod))
                return;
            if (!symbol.isMixin)
                return;
            if (!symbol.args || symbol.args.length == 0)
                return;
            if (!dbType.inheritsFrom(symbol.args[0].typename))
                return;

            if (mixinSeen.has(symbol.id))
                return;
            mixinSeen.add(symbol.id);

            let namespaceName = namespace.isRootNamespace() ? "" : namespace.getQualifiedNamespace();
            let visibility = getTypeVisibility(symbol.isPrivate, symbol.isProtected);
            let accessorKind : "get" | "set" | null = null;
            let propertyName : string | null = null;
            let isAccessor = false;
            if (symbol.isProperty)
            {
                if (symbol.name.startsWith("Get"))
                {
                    accessorKind = "get";
                    propertyName = symbol.name.substring(3);
                    isAccessor = propertyName.length > 0;
                }
                else if (symbol.name.startsWith("Set"))
                {
                    accessorKind = "set";
                    propertyName = symbol.name.substring(3);
                    isAccessor = propertyName.length > 0;
                }
            }

            let signature = buildMethodSignature(symbol, "", isAccessor, accessorKind, propertyName);
            let description = "";
            if (includeDocs)
                description = formatFunctionDocumentationPlain(symbol.findAvailableDocumentation());
            signature = getVisibilityPrefix(visibility) + signature;

            members.push({
                kind: "method",
                name: symbol.name,
                signature: signature,
                description: description ?? "",
                declaredIn: namespaceName,
                declaredInKind: "namespace",
                isInherited: false,
                isMixin: true,
                isAccessor: isAccessor,
                accessorKind: accessorKind ?? undefined,
                propertyName: propertyName ?? undefined,
                visibility: visibility,
            });
        });

        for (let [_, child] of namespace.childNamespaces)
            visitNamespace(child);
    };

    visitNamespace(typedb.GetRootNamespace());

    return {
        ok: true,
        type: {
            name: dbType.name,
            namespace: typeNamespace,
            qualifiedName: qualifiedName,
        },
        members: members,
    };
}

export function GetTypeHierarchy(params: TypeHierarchyParams) : TypeHierarchyResult
{
    if (!params || typeof params !== "object")
        return { ok: false, error: { code: "InvalidParams", message: "Invalid params. Provide { name: string, maxSuperDepth?: number, maxSubDepth?: number, maxSubBreadth?: number }." } };

    let name = typeof params.name === "string" ? params.name.trim() : "";
    if (name.length == 0)
        return { ok: false, error: { code: "InvalidParams", message: "Invalid params. 'name' must be a non-empty string." } };

    let dbType = resolveTypeByName(name, undefined);
    if (!dbType)
        return { ok: false, error: { code: "NotFound", message: "Type not found." } };
    if (!isClassType(dbType))
        return { ok: false, error: { code: "InvalidParams", message: `Type "${name}" is not a class. Provide a class name such as "APawn".` } };

    let maxSuperDepth = 3;
    if (params.maxSuperDepth !== undefined)
    {
        if (typeof params.maxSuperDepth !== "number" || !Number.isInteger(params.maxSuperDepth) || params.maxSuperDepth < 0)
            return { ok: false, error: { code: "InvalidParams", message: "Invalid params. 'maxSuperDepth' must be a non-negative integer." } };
        maxSuperDepth = params.maxSuperDepth;
    }

    let maxSubDepth = 2;
    if (params.maxSubDepth !== undefined)
    {
        if (typeof params.maxSubDepth !== "number" || !Number.isInteger(params.maxSubDepth) || params.maxSubDepth < 0)
            return { ok: false, error: { code: "InvalidParams", message: "Invalid params. 'maxSubDepth' must be a non-negative integer." } };
        maxSubDepth = params.maxSubDepth;
    }

    let maxSubBreadth = 10;
    if (params.maxSubBreadth !== undefined)
    {
        if (typeof params.maxSubBreadth !== "number" || !Number.isInteger(params.maxSubBreadth) || params.maxSubBreadth < 0)
            return { ok: false, error: { code: "InvalidParams", message: "Invalid params. 'maxSubBreadth' must be a non-negative integer." } };
        maxSubBreadth = params.maxSubBreadth;
    }

    if (maxSuperDepth == 0 && maxSubDepth == 0)
        return { ok: false, error: { code: "InvalidParams", message: "Invalid params. 'maxSuperDepth' and 'maxSubDepth' cannot both be 0." } };

    let sourceByClass: Record<string, {
        source: "cpp";
    } | {
        source: "as";
        filePath: string;
        startLine: number;
        endLine: number;
    }> = {};
    sourceByClass[dbType.name] = getScriptClassSourceInfo(dbType);

    let supers: string[] = [];
    let superVisited = new Set<typedb.DBType>();
    let current = dbType;
    let superDepth = 0;
    while (superDepth < maxSuperDepth)
    {
        let next = resolveHierarchySuperType(current);
        if (!next || superVisited.has(next))
            break;
        superVisited.add(next);
        sourceByClass[next.name] = getScriptClassSourceInfo(next);
        supers.push(next.name);
        current = next;
        superDepth += 1;
    }

    let supersTruncated = false;
    if (superDepth >= maxSuperDepth)
    {
        let next = resolveHierarchySuperType(current);
        if (next && !superVisited.has(next))
            supersTruncated = true;
    }

    let subtypeIndex = buildSubtypeIndex();
    let subtypeVisited = new Set<typedb.DBType>();
    subtypeVisited.add(dbType);
    let derivedByParent: Record<string, string[]> = {};
    let derivedBreadthByClass: Record<string, number> = {};
    let derivedDepthTruncated = buildDerivedEdges(
        dbType,
        maxSubDepth,
        maxSubBreadth,
        subtypeIndex,
        subtypeVisited,
        derivedByParent,
        sourceByClass,
        derivedBreadthByClass
    );

    return {
        ok: true,
        root: dbType.name,
        supers: supers,
        derivedByParent: derivedByParent,
        sourceByClass: sourceByClass,
        limits: {
            maxSuperDepth,
            maxSubDepth,
            maxSubBreadth,
        },
        truncated: {
            supers: supersTruncated,
            derivedDepth: derivedDepthTruncated,
            derivedBreadthByClass: derivedBreadthByClass,
        },
    };
}

export function GetAPISearch(filter: string, source?: string): any
{
    let list: any[] = [];
    let sourceFilter = normalizeSearchSource(source);
    type SearchToken = {
        value: string;
        isSeparator: boolean;
        tightPrev: boolean;
    };
    let phraseGroups: Array<Array<SearchToken>> = [];
    let tokenRegex = /::|\.|[A-Za-z0-9_]+/g;
    for (let rawGroup of filter.split("|"))
    {
        let group = new Array<SearchToken>();
        let regex = new RegExp(tokenRegex.source, "g");
        let prevEnd = -1;
        let match: RegExpExecArray;
        while ((match = regex.exec(rawGroup)) !== null)
        {
            let token = match[0];
            let start = match.index ?? 0;
            let end = start + token.length;
            let hasSpaceBefore = false;
            if (prevEnd >= 0)
            {
                let gap = rawGroup.substring(prevEnd, start);
                hasSpaceBefore = /\s/.test(gap);
            }

            let isSeparator = token == "." || token == "::";
            group.push({
                value: isSeparator ? token : token.toLowerCase(),
                isSeparator: isSeparator,
                tightPrev: prevEnd >= 0 && !hasSpaceBefore,
            });
            prevEnd = end;
        }

        if (group.length > 0)
            phraseGroups.push(group);
    }

    if (phraseGroups.length == 0)
        return [];

    let groupMatches = function (name: string, group: Array<SearchToken>)
    {
        if (group.length == 0)
            return false;

        let lowerName = name.toLowerCase();
        let searchIndex = 0;
        for (let token of group)
        {
            if (token.isSeparator)
            {
                let matchIndex = name.indexOf(token.value, searchIndex);
                if (matchIndex == -1)
                    return false;
                if (token.tightPrev && matchIndex != searchIndex)
                    return false;
                searchIndex = matchIndex + token.value.length;
                continue;
            }

            let matchIndex = lowerName.indexOf(token.value, searchIndex);
            if (matchIndex == -1)
                return false;
            searchIndex = matchIndex + token.value.length;
        }

        return true;
    }

    let canComplete = function (name: string)
    {
        for (let group of phraseGroups)
        {
            if (groupMatches(name, group))
                return true;
        }
        return false;
    }

    let isWordChar = function (char: string) : boolean
    {
        let code = char.charCodeAt(0);
        return (code >= 48 && code <= 57)
            || (code >= 65 && code <= 90)
            || (code >= 97 && code <= 122)
            || code == 95;
    }

    let isUpper = function (char: string) : boolean
    {
        let code = char.charCodeAt(0);
        return code >= 65 && code <= 90;
    }

    let isLower = function (char: string) : boolean
    {
        let code = char.charCodeAt(0);
        return code >= 97 && code <= 122;
    }

    let scoreUppercase = function (name: string, index: number, length: number) : number
    {
        let score = 0;
        let end = Math.min(name.length, index + length);
        for (let i = index; i < end; ++i)
        {
            if (isUpper(name[i]))
                score += 25;
        }
        if (index < name.length && isUpper(name[index]))
            score += 40;
        return score;
    }

    let isBoundary = function (name: string, index: number) : boolean
    {
        if (index <= 0)
            return true;
        let prev = name[index - 1];
        let curr = name[index];
        if (!isWordChar(prev))
            return true;
        if (isLower(prev) && isUpper(curr))
            return true;
        return false;
    }

    let scoreToken = function (name: string, index: number, length: number) : number
    {
        let score = 0;
        if (index == 0)
            score += 200;
        if (isBoundary(name, index))
            score += 150;
        score += scoreUppercase(name, index, length);
        score += Math.max(0, 100 - index);
        score += Math.max(0, 20 - length);
        return score;
    }

    let scoreGroup = function (name: string, lowerName: string, group: Array<SearchToken>) : number
    {
        if (group.length == 0)
            return -1;

        let searchIndex = 0;
        let score = 0;
        for (let token of group)
        {
            if (token.isSeparator)
            {
                let matchIndex = name.indexOf(token.value, searchIndex);
                if (matchIndex == -1)
                    return -1;
                if (token.tightPrev && matchIndex != searchIndex)
                    return -1;
                score += token.value == "::" ? 60 : 40;
                searchIndex = matchIndex + token.value.length;
                continue;
            }

            let matchIndex = lowerName.indexOf(token.value, searchIndex);
            if (matchIndex == -1)
                return -1;
            score += scoreToken(name, matchIndex, token.value.length);
            searchIndex = matchIndex + token.value.length;
        }

        if (group.length == 1 && !group[0].isSeparator && lowerName == group[0].value)
            score += 300;

        score += Math.max(0, 50 - name.length);
        return score;
    }

    let scoreName = function (name: string) : number
    {
        if (!name)
            return -1;

        let lowerName = name.toLowerCase();
        let best = -1;
        for (let group of phraseGroups)
        {
            let groupScore = scoreGroup(name, lowerName, group);
            if (groupScore > best)
                best = groupScore;
        }
        return best;
    }

    let seenIds = new Set<string>();
    let typeResults: any[] = [];

    let searchType = function (type: typedb.DBType | typedb.DBNamespace)
    {
        let typePrefix: string = "";
        let typeMatches = false;
        if (type instanceof typedb.DBNamespace)
        {
            for (let [_, childNamespace] of type.childNamespaces)
            {
                if (childNamespace.isShadowingType())
                    continue;

                searchType(childNamespace);
            }

            if (!type.isRootNamespace())
            {
                typePrefix = type.getQualifiedNamespace() + "::";
                // Check both the namespace name and the full qualified namespace (including "::")
                typeMatches = canComplete(type.name) || canComplete(typePrefix);
            }
        }
        else
        {
            typePrefix = type.getQualifiedTypenameInNamespace(null) + ".";
            // Check both the type name and the full qualified type name (including ".")
            typeMatches = canComplete(type.name) || canComplete(typePrefix);
        }

        if (!(type instanceof typedb.DBNamespace))
        {
            if (typeMatches && !type.isDelegate && !type.isEvent && !type.isPrimitive && !type.isTemplateInstantiation)
            {
                if (matchesSearchSource(type.declaredModule, sourceFilter))
                {
                    let displayName = type.name;
                    if (type.isTemplateType() && type.templateSubTypes && type.templateSubTypes.length > 0)
                        displayName = typedb.FormatTemplateTypename(type.name, type.templateSubTypes);

                    let typeNamespace = type.namespace && !type.namespace.isRootNamespace()
                        ? type.namespace.getQualifiedNamespace()
                        : "";

                    let typeKind = "class";
                    if (type.isEnum)
                        typeKind = "enum";
                    else if (type.isStruct)
                        typeKind = "struct";

                    let uniqueId = ["type", type.name, typeNamespace].join("|");
                    if (!seenIds.has(uniqueId))
                    {
                        seenIds.add(uniqueId);
                        typeResults.push({
                            "type": "type",
                            "label": displayName,
                            "id": uniqueId,
                            "data": ["type", type.name, typeNamespace, typeKind],
                        });
                    }
                }
            }
        }

        let getConstructorOwnerType = function (symbol: typedb.DBMethod): typedb.DBType | null
        {
            if (symbol.containingType)
                return symbol.containingType;

            if (symbol.namespace)
            {
                let shadowed = symbol.namespace.getShadowedType();
                if (shadowed)
                    return shadowed;
            }

            if (symbol.returnType)
            {
                let lookupNamespace = symbol.namespace;
                if (lookupNamespace && lookupNamespace.isRootNamespace())
                    lookupNamespace = null;
                let found = typedb.LookupType(lookupNamespace, symbol.returnType);
                if (found)
                    return found;
                found = typedb.GetTypeByName(symbol.returnType);
                if (found)
                    return found;
            }

            if (symbol.name)
            {
                let found = typedb.GetTypeByName(symbol.name);
                if (found)
                    return found;
            }

            return null;
        }

        type.forEachSymbol(function (symbol: typedb.DBSymbol)
        {
            if (symbol instanceof typedb.DBMethod)
            {
                if (!matchesSearchSource(symbol.declaredModule, sourceFilter))
                    return;
                if (symbol.isConstructor && (!symbol.args || symbol.args.length == 0))
                    return;
                if (symbol.isConstructor && symbol.args && symbol.args.length == 1)
                    return;
                if (symbol.isConstructor)
                {
                    let ctorType = getConstructorOwnerType(symbol);
                    if (ctorType && (ctorType.isDelegate || ctorType.isEvent))
                        return;
                }
                if (symbol.name.startsWith("op"))
                    return;
                // Also check the full qualified name (prefix + symbol name)
                let fullName = typePrefix + symbol.name;
                if (typeMatches || canComplete(symbol.name) || canComplete(fullName))
                {
                    let symbol_id;
                    if (symbol.containingType)
                    {
                        let methodNamespace = symbol.containingType.namespace
                            ? symbol.containingType.namespace.getQualifiedNamespace()
                            : "";
                        let methodArgs = symbol.args ? symbol.args.map((arg) => arg.typename) : [];
                        symbol_id = ["method", symbol.containingType.name, symbol.name, symbol.id, methodNamespace, methodArgs];
                    }
                    else if (symbol.namespace && !symbol.namespace.isRootNamespace())
                    {
                        let methodArgs = symbol.args ? symbol.args.map((arg) => arg.typename) : [];
                        symbol_id = ["function", symbol.namespace.getQualifiedNamespace() + "::" + symbol.name, symbol.id, methodArgs];
                    }
                    else
                    {
                        let methodArgs = symbol.args ? symbol.args.map((arg) => arg.typename) : [];
                        symbol_id = ["function", symbol.name, symbol.id, methodArgs];
                    }

                    let label = typePrefix + symbol.name + "()";
                    if (symbol.isConstructor)
                    {
                        let ctorArgs = "";
                        if (symbol.args && symbol.args.length > 0)
                        {
                            ctorArgs = symbol.args.map((arg) =>
                            {
                                if (arg.name)
                                    return arg.typename + " " + arg.name;
                                return arg.typename;
                            }).join(", ");
                        }
                        let ctorTypeName = "";
                        let ctorType = getConstructorOwnerType(symbol);
                        if (ctorType)
                        {
                            ctorTypeName = ctorType.getQualifiedTypenameInNamespace(null);
                        }
                        else if (symbol.returnType)
                        {
                            if (symbol.namespace && !symbol.namespace.isRootNamespace())
                                ctorTypeName = symbol.namespace.getQualifiedNamespace() + "::" + symbol.returnType;
                            else
                                ctorTypeName = symbol.returnType;
                        }
                        else if (symbol.name)
                        {
                            ctorTypeName = symbol.name;
                        }

                        if (!ctorTypeName && typePrefix)
                        {
                            if (typePrefix.endsWith("."))
                                ctorTypeName = typePrefix.substring(0, typePrefix.length - 1);
                            else if (typePrefix.endsWith("::"))
                                ctorTypeName = typePrefix.substring(0, typePrefix.length - 2);
                        }
                        label = "<ctor>" + ctorTypeName + "(" + ctorArgs + ")";
                    }
                    else if (symbol.isMixin)
                    {
                        label = symbol.args[0].typename + "." + symbol.name + "()";
                    }

                    let uniqueId = symbol_id.join("|");
                    if (!seenIds.has(uniqueId))
                    {
                        seenIds.add(uniqueId);
                        list.push({
                            "type": "function",
                            "label": label,
                            "id": symbol.id.toString(),
                            "data": symbol_id,
                        });
                    }
                }
            }
            else if (symbol instanceof typedb.DBProperty)
            {
                if (!matchesSearchSource(symbol.declaredModule, sourceFilter))
                    return;
                // Also check the full qualified name (prefix + symbol name)
                let fullName = typePrefix + symbol.name;
                if (typeMatches || canComplete(symbol.name) || canComplete(fullName))
                {
                    let symbol_id;
                    if (symbol.containingType)
                        symbol_id = ["property", symbol.containingType.name, symbol.name];
                    else if (symbol.namespace && !symbol.namespace.isRootNamespace())
                        symbol_id = ["global", symbol.namespace.getQualifiedNamespace() + "::" + symbol.name];
                    else
                        symbol_id = ["global", symbol.name];

                    let uniqueId = symbol_id.join("|");
                    if (!seenIds.has(uniqueId))
                    {
                        seenIds.add(uniqueId);
                        list.push({
                            "type": "property",
                            "label": typePrefix + symbol.name,
                            "id": typePrefix + symbol.name,
                            "data": symbol_id,
                        });
                    }
                }
            }
            else if (symbol instanceof typedb.DBType)
            {
                if (!symbol.isTemplateInstantiation && !symbol.isTemplateType() && !symbol.isDelegate && !symbol.isEvent)
                    searchType(symbol);
            }
        }, false);
    }

    searchType(typedb.GetRootNamespace());

    if (typeResults.length > 0)
        list = typeResults.concat(list);

    let getSearchName = function (item: any) : string
    {
        if (item && item.type == "type" && Array.isArray(item.data))
        {
            let name = item.data[1] as string;
            let typeNamespace = item.data[2] as string;
            if (typeNamespace)
                return typeNamespace + "::" + name;
            return name;
        }
        return item && item.label ? String(item.label) : "";
    }

    let scoreCache = new Map<any, number>();
    let getItemScore = function (item: any) : number
    {
        if (scoreCache.has(item))
            return scoreCache.get(item);
        let score = scoreName(getSearchName(item));
        scoreCache.set(item, score);
        return score;
    }

    let getTypeOrder = function (item: any) : number
    {
        let kind = item && item.data ? item.data[0] : "";
        if (kind == "type")
            return 0;
        if (kind == "function")
            return 1;
        if (kind == "property")
            return 2;
        return 3;
    }

    list.sort(function (a, b)
    {
        let orderA = getTypeOrder(a);
        let orderB = getTypeOrder(b);
        if (orderA != orderB)
            return orderA - orderB;

        let scoreA = getItemScore(a);
        let scoreB = getItemScore(b);
        if (scoreA != scoreB)
            return scoreB - scoreA;

        if (a.label < b.label)
            return -1;
        else if (a.label > b.label)
            return 1;

        return 0;
    });

    return list;
}
